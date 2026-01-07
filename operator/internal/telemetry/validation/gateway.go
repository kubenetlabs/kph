package validation

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// GatewayValidationResult represents the validation result for a Gateway API resource
type GatewayValidationResult struct {
	Kind          string    `json:"kind"`
	Name          string    `json:"name"`
	Namespace     string    `json:"namespace"`
	Valid         bool      `json:"valid"`
	Errors        []string  `json:"errors,omitempty"`
	Warnings      []string  `json:"warnings,omitempty"`
	ValidatedAt   time.Time `json:"validatedAt"`
}

// GatewayValidationSummary contains aggregated Gateway API validation stats
type GatewayValidationSummary struct {
	Timestamp        time.Time                  `json:"timestamp"`
	TotalRoutes      int                        `json:"totalRoutes"`
	ValidRoutes      int                        `json:"validRoutes"`
	InvalidRoutes    int                        `json:"invalidRoutes"`
	TotalGateways    int                        `json:"totalGateways"`
	ValidationResults []GatewayValidationResult `json:"validationResults,omitempty"`
}

// GatewayValidator validates Gateway API resources
type GatewayValidator struct {
	client       client.Client
	log          logr.Logger

	// Cached resources
	gateways     []gatewayv1.Gateway
	httpRoutes   []gatewayv1.HTTPRoute
	services     map[string]*corev1.Service // namespace/name -> service
	gatewaysMu   sync.RWMutex

	// Results
	results      []GatewayValidationResult
	resultsMu    sync.Mutex
}

// NewGatewayValidator creates a new Gateway API validator
func NewGatewayValidator(c client.Client, log logr.Logger) *GatewayValidator {
	return &GatewayValidator{
		client:   c,
		log:      log.WithName("gateway-validator"),
		services: make(map[string]*corev1.Service),
	}
}

// RefreshResources fetches all Gateway API resources and services from the cluster
func (v *GatewayValidator) RefreshResources(ctx context.Context) error {
	v.log.V(1).Info("Refreshing Gateway API resources")

	// Fetch Gateways
	var gatewayList gatewayv1.GatewayList
	if err := v.client.List(ctx, &gatewayList); err != nil {
		v.log.Error(err, "Failed to list Gateways")
		return err
	}

	// Fetch HTTPRoutes
	var httpRouteList gatewayv1.HTTPRouteList
	if err := v.client.List(ctx, &httpRouteList); err != nil {
		v.log.Error(err, "Failed to list HTTPRoutes")
		return err
	}

	// Fetch Services (for backend validation)
	var serviceList corev1.ServiceList
	if err := v.client.List(ctx, &serviceList); err != nil {
		v.log.Error(err, "Failed to list Services")
		return err
	}

	// Build service map
	serviceMap := make(map[string]*corev1.Service)
	for i := range serviceList.Items {
		svc := &serviceList.Items[i]
		key := fmt.Sprintf("%s/%s", svc.Namespace, svc.Name)
		serviceMap[key] = svc
	}

	v.gatewaysMu.Lock()
	v.gateways = gatewayList.Items
	v.httpRoutes = httpRouteList.Items
	v.services = serviceMap
	v.gatewaysMu.Unlock()

	v.log.Info("Gateway API resources refreshed",
		"gateways", len(gatewayList.Items),
		"httpRoutes", len(httpRouteList.Items),
		"services", len(serviceMap))

	return nil
}

// ValidateAll validates all Gateway API resources
func (v *GatewayValidator) ValidateAll(ctx context.Context) (*GatewayValidationSummary, error) {
	// Refresh resources first
	if err := v.RefreshResources(ctx); err != nil {
		return nil, err
	}

	v.gatewaysMu.RLock()
	gateways := v.gateways
	httpRoutes := v.httpRoutes
	v.gatewaysMu.RUnlock()

	var results []GatewayValidationResult
	validRoutes := 0
	invalidRoutes := 0

	// Validate each HTTPRoute
	for _, route := range httpRoutes {
		result := v.validateHTTPRoute(&route, gateways)
		results = append(results, result)
		if result.Valid {
			validRoutes++
		} else {
			invalidRoutes++
		}
	}

	// Store results
	v.resultsMu.Lock()
	v.results = results
	v.resultsMu.Unlock()

	summary := &GatewayValidationSummary{
		Timestamp:         time.Now(),
		TotalRoutes:       len(httpRoutes),
		ValidRoutes:       validRoutes,
		InvalidRoutes:     invalidRoutes,
		TotalGateways:     len(gateways),
		ValidationResults: results,
	}

	v.log.Info("Gateway API validation complete",
		"totalRoutes", summary.TotalRoutes,
		"validRoutes", summary.ValidRoutes,
		"invalidRoutes", summary.InvalidRoutes)

	return summary, nil
}

// validateHTTPRoute validates a single HTTPRoute
func (v *GatewayValidator) validateHTTPRoute(route *gatewayv1.HTTPRoute, gateways []gatewayv1.Gateway) GatewayValidationResult {
	result := GatewayValidationResult{
		Kind:        "HTTPRoute",
		Name:        route.Name,
		Namespace:   route.Namespace,
		Valid:       true,
		ValidatedAt: time.Now(),
	}

	// Validate parentRefs (Gateway attachments)
	for _, parentRef := range route.Spec.ParentRefs {
		if err := v.validateParentRef(route, parentRef, gateways); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, err.Error())
		}
	}

	// Validate backendRefs (Service existence)
	for _, rule := range route.Spec.Rules {
		for _, backendRef := range rule.BackendRefs {
			if err := v.validateBackendRef(route.Namespace, backendRef); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, err.Error())
			}
		}
	}

	// Add warnings for potential issues
	if len(route.Spec.Hostnames) == 0 {
		result.Warnings = append(result.Warnings, "No hostnames specified, route will match all hosts")
	}

	return result
}

// validateParentRef validates that a parentRef points to an existing Gateway
func (v *GatewayValidator) validateParentRef(route *gatewayv1.HTTPRoute, parentRef gatewayv1.ParentReference, gateways []gatewayv1.Gateway) error {
	// Determine namespace (default to route's namespace if not specified)
	namespace := route.Namespace
	if parentRef.Namespace != nil {
		namespace = string(*parentRef.Namespace)
	}

	gatewayName := string(parentRef.Name)

	// Find the referenced Gateway
	var foundGateway *gatewayv1.Gateway
	for i := range gateways {
		gw := &gateways[i]
		if gw.Name == gatewayName && gw.Namespace == namespace {
			foundGateway = gw
			break
		}
	}

	if foundGateway == nil {
		return fmt.Errorf("Gateway '%s/%s' not found", namespace, gatewayName)
	}

	// Check if cross-namespace reference is allowed (needs ReferenceGrant)
	if namespace != route.Namespace {
		// For now, just warn - full ReferenceGrant validation would require fetching those resources
		v.log.V(1).Info("Cross-namespace Gateway reference detected",
			"route", fmt.Sprintf("%s/%s", route.Namespace, route.Name),
			"gateway", fmt.Sprintf("%s/%s", namespace, gatewayName))
	}

	// Validate section name if specified
	if parentRef.SectionName != nil {
		sectionName := string(*parentRef.SectionName)
		listenerFound := false
		for _, listener := range foundGateway.Spec.Listeners {
			if string(listener.Name) == sectionName {
				listenerFound = true
				break
			}
		}
		if !listenerFound {
			return fmt.Errorf("Gateway '%s/%s' has no listener named '%s'", namespace, gatewayName, sectionName)
		}
	}

	return nil
}

// validateBackendRef validates that a backendRef points to an existing Service
func (v *GatewayValidator) validateBackendRef(routeNamespace string, backendRef gatewayv1.HTTPBackendRef) error {
	// Only validate Service backends (default kind)
	kind := "Service"
	if backendRef.Kind != nil {
		kind = string(*backendRef.Kind)
	}

	if kind != "Service" {
		// Non-service backends are not validated here
		return nil
	}

	// Determine namespace
	namespace := routeNamespace
	if backendRef.Namespace != nil {
		namespace = string(*backendRef.Namespace)
	}

	serviceName := string(backendRef.Name)
	serviceKey := fmt.Sprintf("%s/%s", namespace, serviceName)

	v.gatewaysMu.RLock()
	_, exists := v.services[serviceKey]
	v.gatewaysMu.RUnlock()

	if !exists {
		return fmt.Errorf("Service '%s' not found", serviceKey)
	}

	// Check if port exists on service
	if backendRef.Port != nil {
		v.gatewaysMu.RLock()
		svc := v.services[serviceKey]
		v.gatewaysMu.RUnlock()

		if svc != nil {
			portFound := false
			targetPort := int32(*backendRef.Port)
			for _, port := range svc.Spec.Ports {
				if port.Port == targetPort {
					portFound = true
					break
				}
			}
			if !portFound {
				return fmt.Errorf("Service '%s' has no port %d", serviceKey, targetPort)
			}
		}
	}

	// Check cross-namespace reference
	if namespace != routeNamespace {
		v.log.V(1).Info("Cross-namespace backend reference detected",
			"routeNamespace", routeNamespace,
			"serviceNamespace", namespace,
			"serviceName", serviceName)
		// Full ReferenceGrant validation would go here
	}

	return nil
}

// GetLastResults returns the most recent validation results
func (v *GatewayValidator) GetLastResults() []GatewayValidationResult {
	v.resultsMu.Lock()
	defer v.resultsMu.Unlock()

	// Return a copy to avoid race conditions
	results := make([]GatewayValidationResult, len(v.results))
	copy(results, v.results)
	return results
}

// ValidateSingleRoute validates a single HTTPRoute by name
func (v *GatewayValidator) ValidateSingleRoute(ctx context.Context, namespace, name string) (*GatewayValidationResult, error) {
	// Fetch the specific HTTPRoute
	var route gatewayv1.HTTPRoute
	if err := v.client.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &route); err != nil {
		return nil, fmt.Errorf("failed to get HTTPRoute: %w", err)
	}

	// Refresh gateways and services
	if err := v.RefreshResources(ctx); err != nil {
		return nil, err
	}

	v.gatewaysMu.RLock()
	gateways := v.gateways
	v.gatewaysMu.RUnlock()

	result := v.validateHTTPRoute(&route, gateways)
	return &result, nil
}
