package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PolicyHubConfigSpec defines the desired state of PolicyHubConfig
type PolicyHubConfigSpec struct {
	// SaaSEndpoint is the URL of the Policy Hub SaaS platform
	// +kubebuilder:validation:Required
	// +kubebuilder:validation:Pattern=`^https?://`
	SaaSEndpoint string `json:"saasEndpoint"`

	// ClusterID is the unique identifier for this cluster in the SaaS platform
	// Set this if you already have a cluster created in Policy Hub (legacy mode)
	// Leave empty to use bootstrap mode with ClusterName
	// +optional
	ClusterID string `json:"clusterId,omitempty"`

	// ClusterIDSecretRef references the secret containing the cluster ID
	// Alternative to specifying ClusterID directly - useful when cluster ID is in a shared secret
	// +optional
	ClusterIDSecretRef *SecretKeySelector `json:"clusterIdSecretRef,omitempty"`

	// ClusterName is the name for this cluster when using bootstrap mode
	// The operator will register with the SaaS and create the cluster automatically
	// +optional
	ClusterName string `json:"clusterName,omitempty"`

	// APITokenSecretRef references the secret containing the cluster-specific API token
	// Required if ClusterID is set (legacy mode)
	// In bootstrap mode, this is where the token will be stored after registration
	// +optional
	APITokenSecretRef *SecretKeySelector `json:"apiTokenSecretRef,omitempty"`

	// RegistrationTokenSecretRef references the secret containing the registration token
	// Required for bootstrap mode (when ClusterID is not set)
	// +optional
	RegistrationTokenSecretRef *SecretKeySelector `json:"registrationTokenSecretRef,omitempty"`

	// SyncInterval is how often to sync policies from the SaaS platform
	// +kubebuilder:default="30s"
	// +optional
	SyncInterval metav1.Duration `json:"syncInterval,omitempty"`

	// HeartbeatInterval is how often to send heartbeats to the SaaS platform
	// +kubebuilder:default="60s"
	// +optional
	HeartbeatInterval metav1.Duration `json:"heartbeatInterval,omitempty"`

	// FlowCollection configures Hubble flow data collection
	// +optional
	FlowCollection *FlowCollectionSpec `json:"flowCollection,omitempty"`

	// TargetNamespaces limits policy deployment to specific namespaces
	// Empty means all namespaces
	// +optional
	TargetNamespaces []string `json:"targetNamespaces,omitempty"`

	// Provider is the cloud provider (AWS, GCP, AZURE, ON_PREM, OTHER)
	// +optional
	Provider string `json:"provider,omitempty"`

	// Region is the cluster's region
	// +optional
	Region string `json:"region,omitempty"`

	// Environment is the cluster's environment (DEVELOPMENT, STAGING, PRODUCTION, TESTING)
	// +optional
	Environment string `json:"environment,omitempty"`
}

// SecretKeySelector selects a key of a Secret
type SecretKeySelector struct {
	// Name of the secret
	// +kubebuilder:validation:Required
	Name string `json:"name"`

	// Key in the secret to select
	// +kubebuilder:validation:Required
	Key string `json:"key"`

	// Namespace of the secret (defaults to the PolicyHubConfig namespace)
	// +optional
	Namespace string `json:"namespace,omitempty"`
}

// FlowCollectionSpec configures flow data collection
type FlowCollectionSpec struct {
	// Enabled enables flow data collection from Hubble
	// +kubebuilder:default=true
	Enabled bool `json:"enabled,omitempty"`

	// HubbleAddress is the address of the Hubble relay service
	// +kubebuilder:default="hubble-relay.kube-system.svc.cluster.local:4245"
	// +optional
	HubbleAddress string `json:"hubbleAddress,omitempty"`

	// BatchSize is the number of flows to buffer before sending
	// +kubebuilder:default=500
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=10000
	// +optional
	BatchSize int `json:"batchSize,omitempty"`

	// FlushInterval is how often to flush the flow buffer
	// +kubebuilder:default="10s"
	// +optional
	FlushInterval metav1.Duration `json:"flushInterval,omitempty"`
}

// PolicyHubConfigStatus defines the observed state of PolicyHubConfig
type PolicyHubConfigStatus struct {
	// Phase represents the current phase of the operator
	// +kubebuilder:validation:Enum=Initializing;Bootstrapping;Registered;Syncing;Error
	Phase string `json:"phase,omitempty"`

	// OperatorID is the unique identifier assigned during registration
	OperatorID string `json:"operatorId,omitempty"`

	// ClusterID is the cluster ID (set after bootstrap or from spec)
	ClusterID string `json:"clusterId,omitempty"`

	// ClusterName is the cluster name (from bootstrap response or spec)
	ClusterName string `json:"clusterName,omitempty"`

	// Bootstrapped indicates if the operator has completed bootstrap registration
	Bootstrapped bool `json:"bootstrapped,omitempty"`

	// LastHeartbeat is the timestamp of the last successful heartbeat
	LastHeartbeat *metav1.Time `json:"lastHeartbeat,omitempty"`

	// LastSync is the timestamp of the last successful policy sync
	LastSync *metav1.Time `json:"lastSync,omitempty"`

	// ManagedPolicies is the count of policies being managed
	ManagedPolicies int `json:"managedPolicies,omitempty"`

	// Conditions represent the latest available observations
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// Message provides additional status information
	Message string `json:"message,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=phc
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Policies",type=integer,JSONPath=`.status.managedPolicies`
// +kubebuilder:printcolumn:name="Last Sync",type=date,JSONPath=`.status.lastSync`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// PolicyHubConfig is the Schema for the policyhubconfigs API
type PolicyHubConfig struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   PolicyHubConfigSpec   `json:"spec,omitempty"`
	Status PolicyHubConfigStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// PolicyHubConfigList contains a list of PolicyHubConfig
type PolicyHubConfigList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []PolicyHubConfig `json:"items"`
}

// GetSecretRef returns a LocalObjectReference for the API token secret
func (s *SecretKeySelector) GetSecretRef() corev1.LocalObjectReference {
	return corev1.LocalObjectReference{Name: s.Name}
}

func init() {
	SchemeBuilder.Register(&PolicyHubConfig{}, &PolicyHubConfigList{})
}
