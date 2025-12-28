package sync

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	"sigs.k8s.io/controller-runtime/pkg/client"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
	"github.com/policy-hub/operator/internal/policy"
	"github.com/policy-hub/operator/internal/saas"
)

const (
	OperatorVersion = "1.0.0"

	// Condition types
	ConditionTypeRegistered = "Registered"
	ConditionTypeSynced     = "Synced"
	ConditionTypeHealthy    = "Healthy"
)

// Reconciler handles synchronization between SaaS and cluster
type Reconciler struct {
	client        client.Client
	saasClient    *saas.Client
	deployer      *policy.Deployer
	log           logr.Logger
	config        *policyv1alpha1.PolicyHubConfig
	operatorID    string
	registered    bool
	lastSync      time.Time
	lastHeartbeat time.Time
	statusMu      sync.Mutex // Serializes status updates to prevent conflicts
}

// NewReconciler creates a new sync reconciler
func NewReconciler(c client.Client, log logr.Logger) *Reconciler {
	return &Reconciler{
		client: c,
		log:    log.WithName("sync-reconciler"),
	}
}

// Initialize sets up the reconciler with configuration
func (r *Reconciler) Initialize(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) error {
	r.config = config
	r.log.Info("Initializing reconciler",
		"saasEndpoint", config.Spec.SaaSEndpoint,
		"clusterId", config.Spec.ClusterID,
		"clusterName", config.Spec.ClusterName,
		"statusClusterId", config.Status.ClusterID,
		"statusBootstrapped", config.Status.Bootstrapped)

	// Check if bootstrap already completed (status has cluster ID from previous bootstrap)
	if config.Status.Bootstrapped && config.Status.ClusterID != "" {
		r.log.Info("Bootstrap already completed, using stored cluster token",
			"clusterId", config.Status.ClusterID)
		return r.initializeFromBootstrappedState(ctx, config)
	}

	// Resolve cluster ID - either from spec directly or from secret reference
	clusterID := config.Spec.ClusterID
	if clusterID == "" && config.Spec.ClusterIDSecretRef != nil {
		var err error
		clusterID, err = r.getSecretValue(ctx, config.Namespace, config.Spec.ClusterIDSecretRef)
		if err != nil {
			return fmt.Errorf("failed to get cluster ID from secret: %w", err)
		}
		r.log.Info("Resolved cluster ID from secret", "clusterId", clusterID)
	}

	// Check if we need to bootstrap (no clusterId but has clusterName and registrationToken)
	if clusterID == "" && config.Spec.ClusterName != "" && config.Spec.RegistrationTokenSecretRef != nil {
		return r.bootstrap(ctx, config)
	}

	// Legacy mode: use existing cluster ID and API token
	if config.Spec.APITokenSecretRef == nil {
		return fmt.Errorf("apiTokenSecretRef is required when clusterId is set")
	}

	// Get API token from secret
	apiToken, err := r.getAPIToken(ctx, config)
	if err != nil {
		return fmt.Errorf("failed to get API token: %w", err)
	}

	// Create SaaS client
	r.saasClient = saas.NewClient(
		config.Spec.SaaSEndpoint,
		apiToken,
		clusterID,
		r.log,
	)

	// Create policy deployer
	r.deployer = policy.NewDeployer(r.client, r.log)

	return nil
}

// initializeFromBootstrappedState sets up the reconciler after bootstrap has already completed
func (r *Reconciler) initializeFromBootstrappedState(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) error {
	// Get the cluster token that was stored during bootstrap
	clusterToken, err := r.getClusterToken(ctx, config)
	if err != nil {
		return fmt.Errorf("failed to get cluster token: %w", err)
	}

	// Create SaaS client with the stored cluster token
	r.saasClient = saas.NewClient(
		config.Spec.SaaSEndpoint,
		clusterToken,
		config.Status.ClusterID,
		r.log,
	)

	r.operatorID = config.Status.OperatorID
	r.registered = true

	// Create policy deployer
	r.deployer = policy.NewDeployer(r.client, r.log)

	return nil
}

// getClusterToken retrieves the cluster token from the secret created during bootstrap
func (r *Reconciler) getClusterToken(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) (string, error) {
	secret := &corev1.Secret{}
	err := r.client.Get(ctx, types.NamespacedName{
		Name:      "policy-hub-cluster-token",
		Namespace: config.Namespace,
	}, secret)
	if err != nil {
		return "", fmt.Errorf("failed to get cluster token secret: %w", err)
	}

	token, ok := secret.Data["api-token"]
	if !ok {
		return "", fmt.Errorf("api-token key not found in cluster token secret")
	}

	return string(token), nil
}

// bootstrap handles the self-registration flow for new clusters
func (r *Reconciler) bootstrap(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) error {
	r.log.Info("Starting bootstrap flow", "clusterName", config.Spec.ClusterName)

	// Update status to Bootstrapping
	if err := r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
		status.Phase = "Bootstrapping"
		status.Message = "Bootstrapping cluster registration..."
	}); err != nil {
		r.log.Error(err, "Failed to update status to Bootstrapping")
	}

	// Get registration token from secret
	registrationToken, err := r.getRegistrationToken(ctx, config)
	if err != nil {
		return fmt.Errorf("failed to get registration token: %w", err)
	}

	// Create bootstrap client
	bootstrapClient := saas.NewBootstrapClient(config.Spec.SaaSEndpoint, registrationToken, r.log)

	// Get cluster info
	nodeCount, namespaceCount, k8sVersion := r.getClusterInfo(ctx)

	// Call bootstrap endpoint
	resp, err := bootstrapClient.Bootstrap(ctx, saas.BootstrapRequest{
		ClusterName:       config.Spec.ClusterName,
		OperatorVersion:   OperatorVersion,
		KubernetesVersion: k8sVersion,
		NodeCount:         nodeCount,
		NamespaceCount:    namespaceCount,
		Provider:          config.Spec.Provider,
		Region:            config.Spec.Region,
		Environment:       config.Spec.Environment,
	})
	if err != nil {
		// Update status with error
		_ = r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
			status.Phase = "Error"
			status.Message = fmt.Sprintf("Bootstrap failed: %v", err)
		})
		return fmt.Errorf("bootstrap failed: %w", err)
	}

	r.log.Info("Bootstrap successful",
		"clusterId", resp.Cluster.ID,
		"clusterName", resp.Cluster.Name,
		"operatorId", resp.Cluster.OperatorID)

	// Store the cluster token in a secret
	clusterTokenSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "policy-hub-cluster-token",
			Namespace: config.Namespace,
		},
		StringData: map[string]string{
			"api-token": resp.ClusterToken,
		},
	}

	// Create or update the secret
	existingSecret := &corev1.Secret{}
	err = r.client.Get(ctx, types.NamespacedName{
		Name:      clusterTokenSecret.Name,
		Namespace: clusterTokenSecret.Namespace,
	}, existingSecret)
	if err != nil {
		if errors.IsNotFound(err) {
			if err := r.client.Create(ctx, clusterTokenSecret); err != nil {
				return fmt.Errorf("failed to create cluster token secret: %w", err)
			}
		} else {
			return fmt.Errorf("failed to check for existing secret: %w", err)
		}
	} else {
		existingSecret.StringData = clusterTokenSecret.StringData
		if err := r.client.Update(ctx, existingSecret); err != nil {
			return fmt.Errorf("failed to update cluster token secret: %w", err)
		}
	}

	// Update config status with bootstrap results
	if err := r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
		status.Phase = "Registered"
		status.Bootstrapped = true
		status.ClusterID = resp.Cluster.ID
		status.ClusterName = resp.Cluster.Name
		status.OperatorID = resp.Cluster.OperatorID
		status.Message = "Successfully bootstrapped and registered"
		setCondition(&status.Conditions, metav1.Condition{
			Type:               ConditionTypeRegistered,
			Status:             metav1.ConditionTrue,
			Reason:             "BootstrapSucceeded",
			Message:            fmt.Sprintf("Bootstrapped cluster %s with ID %s", resp.Cluster.Name, resp.Cluster.ID),
			LastTransitionTime: metav1.Now(),
		})
	}); err != nil {
		r.log.Error(err, "Failed to update status after bootstrap")
	}

	// Now use the cluster token for the SaaS client
	r.saasClient = saas.NewClient(
		config.Spec.SaaSEndpoint,
		resp.ClusterToken,
		resp.Cluster.ID,
		r.log,
	)

	r.operatorID = resp.Cluster.OperatorID
	r.registered = true

	// Create policy deployer
	r.deployer = policy.NewDeployer(r.client, r.log)

	return nil
}

// getRegistrationToken retrieves the registration token from the referenced secret
func (r *Reconciler) getRegistrationToken(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) (string, error) {
	if config.Spec.RegistrationTokenSecretRef == nil {
		return "", fmt.Errorf("registrationTokenSecretRef is not set")
	}

	secretNamespace := config.Spec.RegistrationTokenSecretRef.Namespace
	if secretNamespace == "" {
		secretNamespace = config.Namespace
	}

	secret := &corev1.Secret{}
	err := r.client.Get(ctx, types.NamespacedName{
		Name:      config.Spec.RegistrationTokenSecretRef.Name,
		Namespace: secretNamespace,
	}, secret)
	if err != nil {
		return "", fmt.Errorf("failed to get secret: %w", err)
	}

	token, ok := secret.Data[config.Spec.RegistrationTokenSecretRef.Key]
	if !ok {
		return "", fmt.Errorf("key %s not found in secret", config.Spec.RegistrationTokenSecretRef.Key)
	}

	return string(token), nil
}

// Register registers the operator with the SaaS platform
func (r *Reconciler) Register(ctx context.Context) error {
	if r.registered {
		return nil
	}

	r.log.Info("Registering operator with SaaS platform")

	// Get cluster info
	nodeCount, namespaceCount, k8sVersion := r.getClusterInfo(ctx)

	resp, err := r.saasClient.Register(ctx, saas.RegisterRequest{
		OperatorVersion:   OperatorVersion,
		KubernetesVersion: k8sVersion,
		NodeCount:         nodeCount,
		NamespaceCount:    namespaceCount,
	})
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}

	r.operatorID = resp.OperatorID
	r.registered = true

	// Update config status
	if err := r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
		status.Phase = "Registered"
		status.OperatorID = resp.OperatorID
		status.Message = fmt.Sprintf("Registered with cluster %s", resp.ClusterName)
		setCondition(&status.Conditions, metav1.Condition{
			Type:               ConditionTypeRegistered,
			Status:             metav1.ConditionTrue,
			Reason:             "RegistrationSucceeded",
			Message:            "Successfully registered with SaaS platform",
			LastTransitionTime: metav1.Now(),
		})
	}); err != nil {
		r.log.Error(err, "Failed to update config status after registration")
	}

	r.log.Info("Successfully registered",
		"operatorId", resp.OperatorID,
		"clusterName", resp.ClusterName)

	return nil
}

// SyncPolicies synchronizes policies from the SaaS platform
func (r *Reconciler) SyncPolicies(ctx context.Context) error {
	r.log.V(1).Info("Starting policy sync")

	// Fetch policies from SaaS
	resp, err := r.saasClient.FetchPolicies(ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch policies: %w", err)
	}

	r.log.Info("Fetched policies from SaaS", "count", resp.Count)

	// Get existing ManagedPolicies
	existingPolicies := &policyv1alpha1.ManagedPolicyList{}
	if err := r.client.List(ctx, existingPolicies, client.InNamespace(r.config.Namespace)); err != nil {
		return fmt.Errorf("failed to list existing policies: %w", err)
	}

	// Build map of existing policies by policy ID
	existingByID := make(map[string]*policyv1alpha1.ManagedPolicy)
	for i := range existingPolicies.Items {
		p := &existingPolicies.Items[i]
		existingByID[p.Spec.PolicyID] = p
	}

	// Process each policy from SaaS
	saasIDs := make(map[string]bool)
	for _, saasPolicy := range resp.Policies {
		saasIDs[saasPolicy.ID] = true

		existing, found := existingByID[saasPolicy.ID]
		if found {
			// Check if update needed
			if existing.Spec.Version < saasPolicy.Version {
				r.log.Info("Updating policy",
					"name", saasPolicy.Name,
					"oldVersion", existing.Spec.Version,
					"newVersion", saasPolicy.Version)

				// Update the ManagedPolicy
				existing.Spec.Content = saasPolicy.Content
				existing.Spec.Version = saasPolicy.Version
				existing.Spec.TargetNamespaces = saasPolicy.TargetNamespaces
				existing.Spec.Description = saasPolicy.Description

				if err := r.client.Update(ctx, existing); err != nil {
					r.log.Error(err, "Failed to update ManagedPolicy", "name", saasPolicy.Name)
					continue
				}
			}
		} else {
			// Create new ManagedPolicy
			r.log.Info("Creating new policy", "name", saasPolicy.Name)

			mp := &policyv1alpha1.ManagedPolicy{
				ObjectMeta: metav1.ObjectMeta{
					Name:      sanitizeName(saasPolicy.Name),
					Namespace: r.config.Namespace,
				},
				Spec: policyv1alpha1.ManagedPolicySpec{
					PolicyID:         saasPolicy.ID,
					Name:             saasPolicy.Name,
					Description:      saasPolicy.Description,
					PolicyType:       policyv1alpha1.PolicyType(saasPolicy.Type),
					Content:          saasPolicy.Content,
					TargetNamespaces: saasPolicy.TargetNamespaces,
					Version:          saasPolicy.Version,
				},
			}

			if err := r.client.Create(ctx, mp); err != nil {
				r.log.Error(err, "Failed to create ManagedPolicy", "name", saasPolicy.Name)
				continue
			}
		}
	}

	// Delete policies that no longer exist in SaaS
	for id, existing := range existingByID {
		if !saasIDs[id] {
			r.log.Info("Deleting removed policy", "name", existing.Name)

			// Delete deployed resources first
			if err := r.deployer.Delete(ctx, existing); err != nil {
				r.log.Error(err, "Failed to delete policy resources", "name", existing.Name)
			}

			// Delete the ManagedPolicy
			if err := r.client.Delete(ctx, existing); err != nil {
				r.log.Error(err, "Failed to delete ManagedPolicy", "name", existing.Name)
			}
		}
	}

	r.lastSync = time.Now()

	// Update config status
	if err := r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
		status.Phase = "Syncing"
		now := metav1.Now()
		status.LastSync = &now
		status.ManagedPolicies = resp.Count
		setCondition(&status.Conditions, metav1.Condition{
			Type:               ConditionTypeSynced,
			Status:             metav1.ConditionTrue,
			Reason:             "SyncSucceeded",
			Message:            fmt.Sprintf("Synced %d policies", resp.Count),
			LastTransitionTime: metav1.Now(),
		})
	}); err != nil {
		r.log.Error(err, "Failed to update config status after sync")
	}

	return nil
}

// ReconcilePolicy reconciles a single ManagedPolicy
func (r *Reconciler) ReconcilePolicy(ctx context.Context, mp *policyv1alpha1.ManagedPolicy) error {
	log := r.log.WithValues("policy", mp.Name, "policyId", mp.Spec.PolicyID)

	// Skip if paused
	if mp.Spec.Paused {
		log.V(1).Info("Policy is paused, skipping")
		return nil
	}

	// Check if deployment needed
	if mp.Status.Phase == policyv1alpha1.ManagedPolicyPhaseDeployed &&
		mp.Status.DeployedVersion == mp.Spec.Version {
		log.V(1).Info("Policy already deployed at current version")
		return nil
	}

	// Validate policy
	if err := r.deployer.ValidatePolicy(mp); err != nil {
		log.Error(err, "Policy validation failed")
		return r.updatePolicyStatus(ctx, mp, policyv1alpha1.ManagedPolicyPhaseFailed, err.Error())
	}

	// Update status to deploying
	if err := r.updatePolicyStatus(ctx, mp, policyv1alpha1.ManagedPolicyPhaseDeploying, ""); err != nil {
		return err
	}

	// Deploy the policy
	result := r.deployer.Deploy(ctx, mp)
	if !result.Success {
		log.Error(result.Error, "Policy deployment failed")

		// Report failure to SaaS
		_, _ = r.saasClient.UpdatePolicyStatus(ctx, mp.Spec.PolicyID, saas.UpdatePolicyStatusRequest{
			Status:  "FAILED",
			Error:   result.Error.Error(),
			Version: mp.Spec.Version,
		})

		return r.updatePolicyStatus(ctx, mp, policyv1alpha1.ManagedPolicyPhaseFailed, result.Error.Error())
	}

	// Update status to deployed
	mp.Status.Phase = policyv1alpha1.ManagedPolicyPhaseDeployed
	mp.Status.DeployedVersion = mp.Spec.Version
	mp.Status.DeployedResources = result.DeployedResources
	mp.Status.LastError = ""
	now := metav1.Now()
	mp.Status.LastDeployed = &now
	mp.Status.ObservedGeneration = mp.Generation

	if err := r.client.Status().Update(ctx, mp); err != nil {
		return fmt.Errorf("failed to update policy status: %w", err)
	}

	// Report success to SaaS
	deployedResources := make([]saas.DeployedResource, len(result.DeployedResources))
	for i, res := range result.DeployedResources {
		deployedResources[i] = saas.DeployedResource{
			APIVersion: res.APIVersion,
			Kind:       res.Kind,
			Name:       res.Name,
			Namespace:  res.Namespace,
		}
	}

	_, err := r.saasClient.UpdatePolicyStatus(ctx, mp.Spec.PolicyID, saas.UpdatePolicyStatusRequest{
		Status:            "DEPLOYED",
		DeployedResources: deployedResources,
		Version:           mp.Spec.Version,
	})
	if err != nil {
		log.Error(err, "Failed to report deployment status to SaaS")
	}

	log.Info("Successfully deployed policy",
		"version", mp.Spec.Version,
		"resources", len(result.DeployedResources))

	return nil
}

// SendHeartbeat sends a heartbeat to the SaaS platform
func (r *Reconciler) SendHeartbeat(ctx context.Context) error {
	// Get cluster info
	nodeCount, namespaceCount, k8sVersion := r.getClusterInfo(ctx)

	// Count managed policies
	policyList := &policyv1alpha1.ManagedPolicyList{}
	if err := r.client.List(ctx, policyList, client.InNamespace(r.config.Namespace)); err != nil {
		r.log.Error(err, "Failed to list policies for heartbeat")
	}

	resp, err := r.saasClient.Heartbeat(ctx, saas.HeartbeatRequest{
		OperatorVersion:      OperatorVersion,
		KubernetesVersion:    k8sVersion,
		NodeCount:            nodeCount,
		NamespaceCount:       namespaceCount,
		ManagedPoliciesCount: len(policyList.Items),
		Status:               "healthy",
	})
	if err != nil {
		return fmt.Errorf("heartbeat failed: %w", err)
	}

	r.lastHeartbeat = time.Now()

	// Update config status
	if err := r.updateConfigStatus(ctx, func(status *policyv1alpha1.PolicyHubConfigStatus) {
		now := metav1.Now()
		status.LastHeartbeat = &now
		status.ManagedPolicies = len(policyList.Items)
		setCondition(&status.Conditions, metav1.Condition{
			Type:               ConditionTypeHealthy,
			Status:             metav1.ConditionTrue,
			Reason:             "HeartbeatSucceeded",
			Message:            fmt.Sprintf("Pending policies: %d", resp.PendingPoliciesCount),
			LastTransitionTime: metav1.Now(),
		})
	}); err != nil {
		r.log.Error(err, "Failed to update config status after heartbeat")
	}

	r.log.V(1).Info("Heartbeat sent successfully",
		"pendingPolicies", resp.PendingPoliciesCount)

	return nil
}

// getAPIToken retrieves the API token from the referenced secret
func (r *Reconciler) getAPIToken(ctx context.Context, config *policyv1alpha1.PolicyHubConfig) (string, error) {
	secretNamespace := config.Spec.APITokenSecretRef.Namespace
	if secretNamespace == "" {
		secretNamespace = config.Namespace
	}

	secret := &corev1.Secret{}
	err := r.client.Get(ctx, types.NamespacedName{
		Name:      config.Spec.APITokenSecretRef.Name,
		Namespace: secretNamespace,
	}, secret)
	if err != nil {
		return "", fmt.Errorf("failed to get secret: %w", err)
	}

	token, ok := secret.Data[config.Spec.APITokenSecretRef.Key]
	if !ok {
		return "", fmt.Errorf("key %s not found in secret", config.Spec.APITokenSecretRef.Key)
	}

	return string(token), nil
}

// getSecretValue retrieves a value from a secret reference
func (r *Reconciler) getSecretValue(ctx context.Context, defaultNamespace string, ref *policyv1alpha1.SecretKeySelector) (string, error) {
	secretNamespace := ref.Namespace
	if secretNamespace == "" {
		secretNamespace = defaultNamespace
	}

	secret := &corev1.Secret{}
	err := r.client.Get(ctx, types.NamespacedName{
		Name:      ref.Name,
		Namespace: secretNamespace,
	}, secret)
	if err != nil {
		return "", fmt.Errorf("failed to get secret %s/%s: %w", secretNamespace, ref.Name, err)
	}

	value, ok := secret.Data[ref.Key]
	if !ok {
		return "", fmt.Errorf("key %s not found in secret %s/%s", ref.Key, secretNamespace, ref.Name)
	}

	return string(value), nil
}

// getClusterInfo retrieves basic cluster information
func (r *Reconciler) getClusterInfo(ctx context.Context) (nodeCount, namespaceCount int, k8sVersion string) {
	// Count nodes
	nodeList := &corev1.NodeList{}
	if err := r.client.List(ctx, nodeList); err == nil {
		nodeCount = len(nodeList.Items)
		// Get k8s version from first node
		if nodeCount > 0 {
			k8sVersion = nodeList.Items[0].Status.NodeInfo.KubeletVersion
		}
	}

	// Count namespaces
	nsList := &corev1.NamespaceList{}
	if err := r.client.List(ctx, nsList); err == nil {
		namespaceCount = len(nsList.Items)
	}

	return
}

// updateConfigStatus updates the PolicyHubConfig status with retry on conflict.
// Uses a mutex to serialize status updates from concurrent goroutines (sync, heartbeat, controller).
func (r *Reconciler) updateConfigStatus(ctx context.Context, mutate func(*policyv1alpha1.PolicyHubConfigStatus)) error {
	r.statusMu.Lock()
	defer r.statusMu.Unlock()

	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		config := &policyv1alpha1.PolicyHubConfig{}
		if err := r.client.Get(ctx, types.NamespacedName{
			Name:      r.config.Name,
			Namespace: r.config.Namespace,
		}, config); err != nil {
			return err
		}

		mutate(&config.Status)
		return r.client.Status().Update(ctx, config)
	})
}

// updatePolicyStatus updates a ManagedPolicy status with retry on conflict
func (r *Reconciler) updatePolicyStatus(ctx context.Context, mp *policyv1alpha1.ManagedPolicy, phase policyv1alpha1.ManagedPolicyPhase, errMsg string) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		// Refetch to get latest resourceVersion
		fresh := &policyv1alpha1.ManagedPolicy{}
		if err := r.client.Get(ctx, types.NamespacedName{Name: mp.Name, Namespace: mp.Namespace}, fresh); err != nil {
			return err
		}
		fresh.Status.Phase = phase
		fresh.Status.LastError = errMsg
		fresh.Status.ObservedGeneration = fresh.Generation
		return r.client.Status().Update(ctx, fresh)
	})
}

// setCondition sets or updates a condition in the conditions slice
func setCondition(conditions *[]metav1.Condition, condition metav1.Condition) {
	for i, c := range *conditions {
		if c.Type == condition.Type {
			(*conditions)[i] = condition
			return
		}
	}
	*conditions = append(*conditions, condition)
}

// sanitizeName converts a policy name to a valid Kubernetes resource name
func sanitizeName(name string) string {
	// Convert to lowercase
	result := make([]byte, 0, len(name))
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c >= 'A' && c <= 'Z' {
			result = append(result, c+32) // lowercase
		} else if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			result = append(result, c)
		} else if c == ' ' || c == '_' {
			result = append(result, '-')
		}
	}

	// Ensure starts with alphanumeric
	if len(result) > 0 && result[0] == '-' {
		result = result[1:]
	}

	// Ensure ends with alphanumeric
	if len(result) > 0 && result[len(result)-1] == '-' {
		result = result[:len(result)-1]
	}

	// Truncate if too long
	if len(result) > 63 {
		result = result[:63]
	}

	return string(result)
}

// IsRegistered returns whether the operator has registered
func (r *Reconciler) IsRegistered() bool {
	return r.registered
}

// GetSyncInterval returns the configured sync interval
func (r *Reconciler) GetSyncInterval() time.Duration {
	if r.config != nil && r.config.Spec.SyncInterval.Duration > 0 {
		return r.config.Spec.SyncInterval.Duration
	}
	return 30 * time.Second
}

// GetHeartbeatInterval returns the configured heartbeat interval
func (r *Reconciler) GetHeartbeatInterval() time.Duration {
	if r.config != nil && r.config.Spec.HeartbeatInterval.Duration > 0 {
		return r.config.Spec.HeartbeatInterval.Duration
	}
	return 60 * time.Second
}
