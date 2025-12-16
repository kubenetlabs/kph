package policy

import (
	"context"
	"fmt"
	"strings"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
)

// Deployer handles deploying policies to Kubernetes
type Deployer struct {
	client client.Client
	log    logr.Logger
}

// NewDeployer creates a new policy deployer
func NewDeployer(c client.Client, log logr.Logger) *Deployer {
	return &Deployer{
		client: c,
		log:    log.WithName("policy-deployer"),
	}
}

// DeployResult contains the result of a deployment operation
type DeployResult struct {
	Success           bool
	DeployedResources []policyv1alpha1.DeployedResource
	Error             error
}

// Deploy deploys a policy to the cluster
func (d *Deployer) Deploy(ctx context.Context, policy *policyv1alpha1.ManagedPolicy) DeployResult {
	d.log.Info("Deploying policy",
		"name", policy.Spec.Name,
		"type", policy.Spec.PolicyType,
		"version", policy.Spec.Version)

	// Parse the policy content
	resources, err := d.parseContent(policy.Spec.Content)
	if err != nil {
		return DeployResult{
			Success: false,
			Error:   fmt.Errorf("failed to parse policy content: %w", err),
		}
	}

	if len(resources) == 0 {
		return DeployResult{
			Success: false,
			Error:   fmt.Errorf("no resources found in policy content"),
		}
	}

	// Deploy each resource
	var deployedResources []policyv1alpha1.DeployedResource
	for _, resource := range resources {
		// Set ownership and labels
		d.setMetadata(resource, policy)

		// Apply the resource
		deployed, err := d.applyResource(ctx, resource, policy)
		if err != nil {
			return DeployResult{
				Success: false,
				Error:   fmt.Errorf("failed to deploy resource %s/%s: %w", resource.GetKind(), resource.GetName(), err),
			}
		}

		deployedResources = append(deployedResources, *deployed)
	}

	d.log.Info("Successfully deployed policy",
		"name", policy.Spec.Name,
		"resourceCount", len(deployedResources))

	return DeployResult{
		Success:           true,
		DeployedResources: deployedResources,
	}
}

// Delete removes all resources associated with a policy
func (d *Deployer) Delete(ctx context.Context, policy *policyv1alpha1.ManagedPolicy) error {
	d.log.Info("Deleting policy resources",
		"name", policy.Spec.Name,
		"resourceCount", len(policy.Status.DeployedResources))

	for _, res := range policy.Status.DeployedResources {
		gvk := schema.FromAPIVersionAndKind(res.APIVersion, res.Kind)

		obj := &unstructured.Unstructured{}
		obj.SetGroupVersionKind(gvk)
		obj.SetName(res.Name)
		obj.SetNamespace(res.Namespace)

		if err := d.client.Delete(ctx, obj); err != nil {
			if !errors.IsNotFound(err) {
				return fmt.Errorf("failed to delete %s/%s: %w", res.Kind, res.Name, err)
			}
		}

		d.log.V(1).Info("Deleted resource",
			"kind", res.Kind,
			"name", res.Name,
			"namespace", res.Namespace)
	}

	return nil
}

// parseContent parses YAML content into unstructured resources
func (d *Deployer) parseContent(content string) ([]*unstructured.Unstructured, error) {
	var resources []*unstructured.Unstructured

	// Split by YAML document separator
	docs := strings.Split(content, "---")
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}

		obj := &unstructured.Unstructured{}
		if err := yaml.Unmarshal([]byte(doc), &obj.Object); err != nil {
			return nil, fmt.Errorf("failed to unmarshal YAML: %w", err)
		}

		// Skip empty objects
		if obj.GetKind() == "" {
			continue
		}

		resources = append(resources, obj)
	}

	return resources, nil
}

// setMetadata adds labels and annotations to track the resource
func (d *Deployer) setMetadata(resource *unstructured.Unstructured, policy *policyv1alpha1.ManagedPolicy) {
	labels := resource.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	labels["app.kubernetes.io/managed-by"] = "policy-hub-operator"
	labels["policyhub.io/policy-id"] = policy.Spec.PolicyID
	labels["policyhub.io/policy-name"] = policy.Spec.Name
	resource.SetLabels(labels)

	annotations := resource.GetAnnotations()
	if annotations == nil {
		annotations = make(map[string]string)
	}
	annotations["policyhub.io/version"] = fmt.Sprintf("%d", policy.Spec.Version)
	annotations["policyhub.io/managed-policy"] = fmt.Sprintf("%s/%s", policy.Namespace, policy.Name)
	resource.SetAnnotations(annotations)
}

// applyResource creates or updates a resource
func (d *Deployer) applyResource(ctx context.Context, resource *unstructured.Unstructured, policy *policyv1alpha1.ManagedPolicy) (*policyv1alpha1.DeployedResource, error) {
	gvk := resource.GroupVersionKind()

	// Handle namespace for namespaced resources
	if resource.GetNamespace() == "" && !d.isClusterScoped(gvk) {
		// Use target namespaces or default to policy namespace
		if len(policy.Spec.TargetNamespaces) > 0 {
			resource.SetNamespace(policy.Spec.TargetNamespaces[0])
		} else {
			resource.SetNamespace(policy.Namespace)
		}
	}

	// Try to get existing resource
	existing := &unstructured.Unstructured{}
	existing.SetGroupVersionKind(gvk)
	err := d.client.Get(ctx, types.NamespacedName{
		Name:      resource.GetName(),
		Namespace: resource.GetNamespace(),
	}, existing)

	if err != nil {
		if errors.IsNotFound(err) {
			// Create new resource
			if err := d.client.Create(ctx, resource); err != nil {
				return nil, fmt.Errorf("failed to create: %w", err)
			}
			d.log.V(1).Info("Created resource",
				"kind", gvk.Kind,
				"name", resource.GetName(),
				"namespace", resource.GetNamespace())
		} else {
			return nil, fmt.Errorf("failed to get existing resource: %w", err)
		}
	} else {
		// Update existing resource
		resource.SetResourceVersion(existing.GetResourceVersion())
		if err := d.client.Update(ctx, resource); err != nil {
			return nil, fmt.Errorf("failed to update: %w", err)
		}
		d.log.V(1).Info("Updated resource",
			"kind", gvk.Kind,
			"name", resource.GetName(),
			"namespace", resource.GetNamespace())
	}

	return &policyv1alpha1.DeployedResource{
		APIVersion: resource.GetAPIVersion(),
		Kind:       resource.GetKind(),
		Name:       resource.GetName(),
		Namespace:  resource.GetNamespace(),
		UID:        string(resource.GetUID()),
	}, nil
}

// isClusterScoped returns true if the resource is cluster-scoped
func (d *Deployer) isClusterScoped(gvk schema.GroupVersionKind) bool {
	// Known cluster-scoped resources
	clusterScoped := map[string]bool{
		"CiliumClusterwideNetworkPolicy": true,
		"ClusterRole":                    true,
		"ClusterRoleBinding":             true,
		"Namespace":                      true,
		"Node":                           true,
		"PersistentVolume":               true,
		"StorageClass":                   true,
		"GatewayClass":                   true,
	}

	return clusterScoped[gvk.Kind]
}

// ValidatePolicy validates that a policy can be deployed
func (d *Deployer) ValidatePolicy(policy *policyv1alpha1.ManagedPolicy) error {
	if policy.Spec.Content == "" {
		return fmt.Errorf("policy content is empty")
	}

	resources, err := d.parseContent(policy.Spec.Content)
	if err != nil {
		return fmt.Errorf("invalid policy content: %w", err)
	}

	if len(resources) == 0 {
		return fmt.Errorf("no valid resources in policy content")
	}

	// Validate each resource has required fields
	for i, res := range resources {
		if res.GetAPIVersion() == "" {
			return fmt.Errorf("resource %d missing apiVersion", i)
		}
		if res.GetKind() == "" {
			return fmt.Errorf("resource %d missing kind", i)
		}
		if res.GetName() == "" {
			return fmt.Errorf("resource %d missing metadata.name", i)
		}
	}

	// Validate policy type matches resource types
	if err := d.validatePolicyType(policy.Spec.PolicyType, resources); err != nil {
		return err
	}

	return nil
}

// validatePolicyType ensures resources match the declared policy type
func (d *Deployer) validatePolicyType(policyType policyv1alpha1.PolicyType, resources []*unstructured.Unstructured) error {
	for _, res := range resources {
		kind := res.GetKind()
		apiVersion := res.GetAPIVersion()

		switch policyType {
		case policyv1alpha1.PolicyTypeCiliumNetwork:
			if kind != "CiliumNetworkPolicy" && kind != "NetworkPolicy" {
				return fmt.Errorf("policy type %s does not support kind %s", policyType, kind)
			}
		case policyv1alpha1.PolicyTypeCiliumClusterwide:
			if kind != "CiliumClusterwideNetworkPolicy" {
				return fmt.Errorf("policy type %s requires kind CiliumClusterwideNetworkPolicy", policyType)
			}
		case policyv1alpha1.PolicyTypeTetragon:
			if kind != "TracingPolicy" && kind != "TracingPolicyNamespaced" {
				return fmt.Errorf("policy type %s requires TracingPolicy kind", policyType)
			}
		case policyv1alpha1.PolicyTypeGatewayHTTPRoute:
			if kind != "HTTPRoute" {
				return fmt.Errorf("policy type %s requires HTTPRoute kind", policyType)
			}
			if !strings.HasPrefix(apiVersion, "gateway.networking.k8s.io/") {
				return fmt.Errorf("HTTPRoute must use gateway.networking.k8s.io API group")
			}
		case policyv1alpha1.PolicyTypeGatewayGRPCRoute:
			if kind != "GRPCRoute" {
				return fmt.Errorf("policy type %s requires GRPCRoute kind", policyType)
			}
		case policyv1alpha1.PolicyTypeGatewayTCPRoute:
			if kind != "TCPRoute" {
				return fmt.Errorf("policy type %s requires TCPRoute kind", policyType)
			}
		}
	}

	return nil
}

// GetDeployedResources lists all resources managed by a policy
func (d *Deployer) GetDeployedResources(ctx context.Context, policyID string) ([]policyv1alpha1.DeployedResource, error) {
	var resources []policyv1alpha1.DeployedResource

	// List resources with the policy label
	labelSelector := client.MatchingLabels{
		"policyhub.io/policy-id": policyID,
	}

	// Check common resource types
	resourceTypes := []schema.GroupVersionKind{
		{Group: "cilium.io", Version: "v2", Kind: "CiliumNetworkPolicy"},
		{Group: "cilium.io", Version: "v2", Kind: "CiliumClusterwideNetworkPolicy"},
		{Group: "cilium.io", Version: "v1alpha1", Kind: "TracingPolicy"},
		{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "HTTPRoute"},
		{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "GRPCRoute"},
		{Group: "gateway.networking.k8s.io", Version: "v1alpha2", Kind: "TCPRoute"},
	}

	for _, gvk := range resourceTypes {
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(gvk)

		if err := d.client.List(ctx, list, labelSelector); err != nil {
			// Skip if CRD doesn't exist
			if errors.IsNotFound(err) || strings.Contains(err.Error(), "no matches for kind") {
				continue
			}
			d.log.V(1).Info("Failed to list resources", "gvk", gvk, "error", err)
			continue
		}

		for _, item := range list.Items {
			resources = append(resources, policyv1alpha1.DeployedResource{
				APIVersion: item.GetAPIVersion(),
				Kind:       item.GetKind(),
				Name:       item.GetName(),
				Namespace:  item.GetNamespace(),
				UID:        string(item.GetUID()),
			})
		}
	}

	return resources, nil
}

// SyncOwnerReference ensures the deployed resource has correct owner reference
func (d *Deployer) SyncOwnerReference(resource *unstructured.Unstructured, owner metav1.Object) {
	ownerRef := metav1.OwnerReference{
		APIVersion: "policyhub.io/v1alpha1",
		Kind:       "ManagedPolicy",
		Name:       owner.GetName(),
		UID:        owner.GetUID(),
	}

	refs := resource.GetOwnerReferences()
	for i, ref := range refs {
		if ref.Kind == "ManagedPolicy" && ref.Name == owner.GetName() {
			refs[i] = ownerRef
			resource.SetOwnerReferences(refs)
			return
		}
	}

	refs = append(refs, ownerRef)
	resource.SetOwnerReferences(refs)
}
