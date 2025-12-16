package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PolicyType defines the type of policy being managed
// +kubebuilder:validation:Enum=CILIUM_NETWORK;CILIUM_CLUSTERWIDE;TETRAGON;GATEWAY_HTTPROUTE;GATEWAY_GRPCROUTE;GATEWAY_TCPROUTE
type PolicyType string

const (
	PolicyTypeCiliumNetwork     PolicyType = "CILIUM_NETWORK"
	PolicyTypeCiliumClusterwide PolicyType = "CILIUM_CLUSTERWIDE"
	PolicyTypeTetragon          PolicyType = "TETRAGON"
	PolicyTypeGatewayHTTPRoute  PolicyType = "GATEWAY_HTTPROUTE"
	PolicyTypeGatewayGRPCRoute  PolicyType = "GATEWAY_GRPCROUTE"
	PolicyTypeGatewayTCPRoute   PolicyType = "GATEWAY_TCPROUTE"
)

// ManagedPolicySpec defines the desired state of ManagedPolicy
type ManagedPolicySpec struct {
	// PolicyID is the unique identifier from the SaaS platform
	// +kubebuilder:validation:Required
	PolicyID string `json:"policyId"`

	// Name is the human-readable name of the policy
	// +kubebuilder:validation:Required
	Name string `json:"name"`

	// Description provides additional context about the policy
	// +optional
	Description string `json:"description,omitempty"`

	// PolicyType specifies the type of policy (Cilium, Tetragon, Gateway API)
	// +kubebuilder:validation:Required
	PolicyType PolicyType `json:"policyType"`

	// Content is the raw YAML content of the policy
	// +kubebuilder:validation:Required
	Content string `json:"content"`

	// TargetNamespaces specifies where to deploy the policy
	// Empty means cluster-wide or default namespace based on policy type
	// +optional
	TargetNamespaces []string `json:"targetNamespaces,omitempty"`

	// Version is the policy version from the SaaS platform
	// +kubebuilder:validation:Minimum=1
	Version int `json:"version"`

	// Paused prevents the policy from being reconciled
	// +kubebuilder:default=false
	// +optional
	Paused bool `json:"paused,omitempty"`
}

// DeployedResource represents a Kubernetes resource created by the policy
type DeployedResource struct {
	// APIVersion of the resource
	APIVersion string `json:"apiVersion"`

	// Kind of the resource
	Kind string `json:"kind"`

	// Name of the resource
	Name string `json:"name"`

	// Namespace of the resource (empty for cluster-scoped)
	// +optional
	Namespace string `json:"namespace,omitempty"`

	// UID of the resource
	// +optional
	UID string `json:"uid,omitempty"`
}

// ManagedPolicyPhase represents the deployment phase
// +kubebuilder:validation:Enum=Pending;Deploying;Deployed;Failed;Deleting
type ManagedPolicyPhase string

const (
	ManagedPolicyPhasePending   ManagedPolicyPhase = "Pending"
	ManagedPolicyPhaseDeploying ManagedPolicyPhase = "Deploying"
	ManagedPolicyPhaseDeployed  ManagedPolicyPhase = "Deployed"
	ManagedPolicyPhaseFailed    ManagedPolicyPhase = "Failed"
	ManagedPolicyPhaseDeleting  ManagedPolicyPhase = "Deleting"
)

// ManagedPolicyStatus defines the observed state of ManagedPolicy
type ManagedPolicyStatus struct {
	// Phase represents the current deployment phase
	Phase ManagedPolicyPhase `json:"phase,omitempty"`

	// DeployedVersion is the currently deployed version
	DeployedVersion int `json:"deployedVersion,omitempty"`

	// DeployedResources lists the Kubernetes resources created
	DeployedResources []DeployedResource `json:"deployedResources,omitempty"`

	// LastDeployed is when the policy was last successfully deployed
	LastDeployed *metav1.Time `json:"lastDeployed,omitempty"`

	// LastError contains the last error message if Phase is Failed
	LastError string `json:"lastError,omitempty"`

	// Conditions represent the latest available observations
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// ObservedGeneration is the generation observed by the controller
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=mp
// +kubebuilder:printcolumn:name="Type",type=string,JSONPath=`.spec.policyType`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Version",type=integer,JSONPath=`.status.deployedVersion`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// ManagedPolicy is the Schema for the managedpolicies API
type ManagedPolicy struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ManagedPolicySpec   `json:"spec,omitempty"`
	Status ManagedPolicyStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ManagedPolicyList contains a list of ManagedPolicy
type ManagedPolicyList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ManagedPolicy `json:"items"`
}

// IsDeployed returns true if the policy is successfully deployed
func (m *ManagedPolicy) IsDeployed() bool {
	return m.Status.Phase == ManagedPolicyPhaseDeployed
}

// NeedsUpdate returns true if the spec version differs from deployed version
func (m *ManagedPolicy) NeedsUpdate() bool {
	return m.Spec.Version != m.Status.DeployedVersion
}

func init() {
	SchemeBuilder.Register(&ManagedPolicy{}, &ManagedPolicyList{})
}
