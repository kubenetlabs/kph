package saas

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-logr/logr"
)

// Client handles communication with the Policy Hub SaaS platform
type Client struct {
	endpoint   string
	apiToken   string
	clusterID  string
	httpClient *http.Client
	log        logr.Logger
}

// NewClient creates a new SaaS client with a cluster-specific token
func NewClient(endpoint, apiToken, clusterID string, log logr.Logger) *Client {
	return &Client{
		endpoint:  endpoint,
		apiToken:  apiToken,
		clusterID: clusterID,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		log: log.WithName("saas-client"),
	}
}

// NewBootstrapClient creates a client for bootstrap mode (using registration token)
func NewBootstrapClient(endpoint, registrationToken string, log logr.Logger) *Client {
	return &Client{
		endpoint:  endpoint,
		apiToken:  registrationToken,
		clusterID: "", // Will be set after bootstrap
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		log: log.WithName("saas-client-bootstrap"),
	}
}

// SetAPIToken updates the API token (used after bootstrap)
func (c *Client) SetAPIToken(token string) {
	c.apiToken = token
}

// SetClusterID updates the cluster ID (used after bootstrap)
func (c *Client) SetClusterID(clusterID string) {
	c.clusterID = clusterID
}

// GetClusterID returns the current cluster ID
func (c *Client) GetClusterID() string {
	return c.clusterID
}

// BootstrapRequest is the request body for cluster bootstrap
type BootstrapRequest struct {
	ClusterName       string `json:"clusterName"`
	OperatorVersion   string `json:"operatorVersion"`
	KubernetesVersion string `json:"kubernetesVersion,omitempty"`
	NodeCount         int    `json:"nodeCount,omitempty"`
	NamespaceCount    int    `json:"namespaceCount,omitempty"`
	Provider          string `json:"provider,omitempty"`
	Region            string `json:"region,omitempty"`
	Environment       string `json:"environment,omitempty"`
}

// BootstrapResponse is the response from cluster bootstrap
type BootstrapResponse struct {
	Success      bool   `json:"success"`
	Cluster      *BootstrapClusterInfo `json:"cluster,omitempty"`
	ClusterToken string `json:"clusterToken,omitempty"`
	TokenPrefix  string `json:"tokenPrefix,omitempty"`
	Config       *BootstrapConfig `json:"config,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

// BootstrapClusterInfo contains cluster info from bootstrap
type BootstrapClusterInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OperatorID string `json:"operatorId"`
}

// BootstrapConfig contains operator config from bootstrap
type BootstrapConfig struct {
	SyncInterval      int `json:"syncInterval"`
	HeartbeatInterval int `json:"heartbeatInterval"`
}

// Bootstrap registers a new cluster and returns a cluster-specific token
func (c *Client) Bootstrap(ctx context.Context, req BootstrapRequest) (*BootstrapResponse, error) {
	c.log.Info("Bootstrapping new cluster with SaaS platform", "clusterName", req.ClusterName)

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal bootstrap request: %w", err)
	}

	resp, err := c.doRequest(ctx, "POST", "/api/operator/bootstrap", body)
	if err != nil {
		return nil, fmt.Errorf("failed to bootstrap: %w", err)
	}

	var result BootstrapResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal bootstrap response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("bootstrap failed: %s", result.Error)
	}

	// Update client with the new cluster-specific token and ID
	if result.ClusterToken != "" {
		c.apiToken = result.ClusterToken
	}
	if result.Cluster != nil {
		c.clusterID = result.Cluster.ID
	}

	c.log.Info("Successfully bootstrapped cluster",
		"clusterId", c.clusterID,
		"clusterName", result.Cluster.Name,
		"operatorId", result.Cluster.OperatorID)

	return &result, nil
}

// RegisterRequest is the request body for operator registration
type RegisterRequest struct {
	OperatorVersion   string `json:"operatorVersion"`
	KubernetesVersion string `json:"kubernetesVersion,omitempty"`
	NodeCount         int    `json:"nodeCount,omitempty"`
	NamespaceCount    int    `json:"namespaceCount,omitempty"`
}

// RegisterResponse is the response from operator registration
type RegisterResponse struct {
	Success           bool   `json:"success"`
	OperatorID        string `json:"operatorId"`
	ClusterID         string `json:"clusterId"`
	ClusterName       string `json:"clusterName"`
	SyncInterval      int    `json:"syncInterval"`
	HeartbeatInterval int    `json:"heartbeatInterval"`
	Error             string `json:"error,omitempty"`
}

// Register registers the operator with the SaaS platform
func (c *Client) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	c.log.Info("Registering operator with SaaS platform")

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal register request: %w", err)
	}

	resp, err := c.doRequest(ctx, "POST", "/api/operator/register", body)
	if err != nil {
		return nil, fmt.Errorf("failed to register: %w", err)
	}

	var result RegisterResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal register response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("registration failed: %s", result.Error)
	}

	c.log.Info("Successfully registered with SaaS platform",
		"operatorId", result.OperatorID,
		"clusterName", result.ClusterName)

	return &result, nil
}

// HeartbeatRequest is the request body for heartbeat
type HeartbeatRequest struct {
	OperatorVersion      string `json:"operatorVersion,omitempty"`
	KubernetesVersion    string `json:"kubernetesVersion,omitempty"`
	NodeCount            int    `json:"nodeCount,omitempty"`
	NamespaceCount       int    `json:"namespaceCount,omitempty"`
	ManagedPoliciesCount int    `json:"managedPoliciesCount,omitempty"`
	Status               string `json:"status,omitempty"` // healthy, degraded, error
	Error                string `json:"error,omitempty"`
}

// HeartbeatResponse is the response from heartbeat
type HeartbeatResponse struct {
	Success              bool   `json:"success"`
	ClusterID            string `json:"clusterId"`
	ClusterStatus        string `json:"clusterStatus"`
	PendingPoliciesCount int    `json:"pendingPoliciesCount"`
	NextHeartbeat        int    `json:"nextHeartbeat"`
	Error                string `json:"error,omitempty"`
}

// Heartbeat sends a heartbeat to the SaaS platform
func (c *Client) Heartbeat(ctx context.Context, req HeartbeatRequest) (*HeartbeatResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal heartbeat request: %w", err)
	}

	resp, err := c.doRequest(ctx, "POST", "/api/operator/heartbeat", body)
	if err != nil {
		return nil, fmt.Errorf("failed to send heartbeat: %w", err)
	}

	var result HeartbeatResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal heartbeat response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("heartbeat failed: %s", result.Error)
	}

	return &result, nil
}

// Policy represents a policy from the SaaS platform
type Policy struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description,omitempty"`
	Type             string   `json:"type"`
	Status           string   `json:"status"`
	Content          string   `json:"content"`
	TargetNamespaces []string `json:"targetNamespaces,omitempty"`
	Version          int      `json:"version"`
	LastUpdated      string   `json:"lastUpdated"`
}

// FetchPoliciesResponse is the response from fetching policies
type FetchPoliciesResponse struct {
	Success  bool     `json:"success"`
	Policies []Policy `json:"policies"`
	Count    int      `json:"count"`
	Error    string   `json:"error,omitempty"`
}

// FetchPolicies retrieves all policies for this cluster
func (c *Client) FetchPolicies(ctx context.Context) (*FetchPoliciesResponse, error) {
	resp, err := c.doRequest(ctx, "GET", "/api/operator/policies", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch policies: %w", err)
	}

	var result FetchPoliciesResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal policies response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("fetch policies failed: %s", result.Error)
	}

	c.log.V(1).Info("Fetched policies from SaaS platform", "count", result.Count)

	return &result, nil
}

// UpdatePolicyStatusRequest is the request body for updating policy status
type UpdatePolicyStatusRequest struct {
	Status            string             `json:"status"` // DEPLOYED or FAILED
	Error             string             `json:"error,omitempty"`
	DeployedResources []DeployedResource `json:"deployedResources,omitempty"`
	Version           int                `json:"version,omitempty"`
}

// DeployedResource represents a deployed Kubernetes resource
type DeployedResource struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace,omitempty"`
}

// UpdatePolicyStatusResponse is the response from updating policy status
type UpdatePolicyStatusResponse struct {
	Success         bool   `json:"success"`
	PolicyID        string `json:"policyId"`
	Status          string `json:"status"`
	DeployedVersion int    `json:"deployedVersion"`
	Error           string `json:"error,omitempty"`
}

// UpdatePolicyStatus updates the deployment status of a policy
func (c *Client) UpdatePolicyStatus(ctx context.Context, policyID string, req UpdatePolicyStatusRequest) (*UpdatePolicyStatusResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal status update request: %w", err)
	}

	path := fmt.Sprintf("/api/operator/policies/%s/status", policyID)
	resp, err := c.doRequest(ctx, "PATCH", path, body)
	if err != nil {
		return nil, fmt.Errorf("failed to update policy status: %w", err)
	}

	var result UpdatePolicyStatusResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal status update response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("status update failed: %s", result.Error)
	}

	c.log.V(1).Info("Updated policy status",
		"policyId", policyID,
		"status", req.Status,
		"version", result.DeployedVersion)

	return &result, nil
}

// FlowRecord represents a network flow record
type FlowRecord struct {
	Timestamp    string            `json:"timestamp"`
	SrcNamespace string            `json:"srcNamespace"`
	SrcPodName   string            `json:"srcPodName,omitempty"`
	SrcPodLabels map[string]string `json:"srcPodLabels,omitempty"`
	SrcIP        string            `json:"srcIP"`
	SrcPort      int               `json:"srcPort,omitempty"`
	DstNamespace string            `json:"dstNamespace"`
	DstPodName   string            `json:"dstPodName,omitempty"`
	DstPodLabels map[string]string `json:"dstPodLabels,omitempty"`
	DstIP        string            `json:"dstIP"`
	DstPort      int               `json:"dstPort"`
	Protocol     string            `json:"protocol"`
	L7Protocol   string            `json:"l7Protocol,omitempty"`
	HTTPMethod   string            `json:"httpMethod,omitempty"`
	HTTPPath     string            `json:"httpPath,omitempty"`
	HTTPStatus   int               `json:"httpStatus,omitempty"`
	Verdict      string            `json:"verdict"`
	BytesTotal   int64             `json:"bytesTotal,omitempty"`
	PacketsTotal int64             `json:"packetsTotal,omitempty"`
}

// SubmitFlowsRequest is the request body for submitting flows
type SubmitFlowsRequest struct {
	Flows []FlowRecord `json:"flows"`
}

// SubmitFlowsResponse is the response from submitting flows
type SubmitFlowsResponse struct {
	Success  bool   `json:"success"`
	Received int    `json:"received"`
	Inserted int    `json:"inserted"`
	Error    string `json:"error,omitempty"`
}

// SubmitFlows sends flow records to the SaaS platform
func (c *Client) SubmitFlows(ctx context.Context, flows []FlowRecord) (*SubmitFlowsResponse, error) {
	if len(flows) == 0 {
		return &SubmitFlowsResponse{Success: true, Received: 0, Inserted: 0}, nil
	}

	req := SubmitFlowsRequest{Flows: flows}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal flows request: %w", err)
	}

	resp, err := c.doRequest(ctx, "POST", "/api/operator/flows", body)
	if err != nil {
		return nil, fmt.Errorf("failed to submit flows: %w", err)
	}

	var result SubmitFlowsResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal flows response: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("submit flows failed: %s", result.Error)
	}

	c.log.V(1).Info("Submitted flows to SaaS platform",
		"sent", len(flows),
		"inserted", result.Inserted)

	return &result, nil
}

// doRequest performs an HTTP request to the SaaS API
func (c *Client) doRequest(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	url := c.endpoint + path

	var reqBody io.Reader
	if body != nil {
		reqBody = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "PolicyHub-Operator/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// SetHTTPClient allows setting a custom HTTP client (useful for testing)
func (c *Client) SetHTTPClient(client *http.Client) {
	c.httpClient = client
}
