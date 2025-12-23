package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
	"github.com/policy-hub/operator/internal/saas"
)

// testScheme returns a scheme with all required types registered
func testScheme() *runtime.Scheme {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = policyv1alpha1.AddToScheme(scheme)
	return scheme
}

// newFakeClient creates a fake client with initial objects
func newFakeClient(objs ...client.Object) client.Client {
	return fake.NewClientBuilder().
		WithScheme(testScheme()).
		WithObjects(objs...).
		WithStatusSubresource(&policyv1alpha1.ManagedPolicy{}, &policyv1alpha1.PolicyHubConfig{}).
		Build()
}

// testLogger returns a no-op logger for testing
func testLogger() logr.Logger {
	return logr.Discard()
}

// --- NewReconciler Tests ---

func TestNewReconciler(t *testing.T) {
	c := newFakeClient()
	log := testLogger()

	r := NewReconciler(c, log)

	if r == nil {
		t.Fatal("Expected non-nil Reconciler")
	}
	if r.client == nil {
		t.Error("Expected client to be set")
	}
	if r.registered {
		t.Error("Expected registered to be false initially")
	}
}

// --- IsRegistered Tests ---

func TestIsRegistered(t *testing.T) {
	c := newFakeClient()
	r := NewReconciler(c, testLogger())

	if r.IsRegistered() {
		t.Error("Expected IsRegistered to be false initially")
	}

	r.registered = true
	if !r.IsRegistered() {
		t.Error("Expected IsRegistered to be true after setting registered")
	}
}

// --- GetSyncInterval Tests ---

func TestGetSyncInterval(t *testing.T) {
	tests := []struct {
		name     string
		config   *policyv1alpha1.PolicyHubConfig
		expected time.Duration
	}{
		{
			name:     "nil config returns default",
			config:   nil,
			expected: 30 * time.Second,
		},
		{
			name: "zero duration returns default",
			config: &policyv1alpha1.PolicyHubConfig{
				Spec: policyv1alpha1.PolicyHubConfigSpec{
					SyncInterval: metav1.Duration{Duration: 0},
				},
			},
			expected: 30 * time.Second,
		},
		{
			name: "custom duration returns custom",
			config: &policyv1alpha1.PolicyHubConfig{
				Spec: policyv1alpha1.PolicyHubConfigSpec{
					SyncInterval: metav1.Duration{Duration: 60 * time.Second},
				},
			},
			expected: 60 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewReconciler(newFakeClient(), testLogger())
			r.config = tt.config

			got := r.GetSyncInterval()
			if got != tt.expected {
				t.Errorf("GetSyncInterval() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// --- GetHeartbeatInterval Tests ---

func TestGetHeartbeatInterval(t *testing.T) {
	tests := []struct {
		name     string
		config   *policyv1alpha1.PolicyHubConfig
		expected time.Duration
	}{
		{
			name:     "nil config returns default",
			config:   nil,
			expected: 60 * time.Second,
		},
		{
			name: "zero duration returns default",
			config: &policyv1alpha1.PolicyHubConfig{
				Spec: policyv1alpha1.PolicyHubConfigSpec{
					HeartbeatInterval: metav1.Duration{Duration: 0},
				},
			},
			expected: 60 * time.Second,
		},
		{
			name: "custom duration returns custom",
			config: &policyv1alpha1.PolicyHubConfig{
				Spec: policyv1alpha1.PolicyHubConfigSpec{
					HeartbeatInterval: metav1.Duration{Duration: 120 * time.Second},
				},
			},
			expected: 120 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewReconciler(newFakeClient(), testLogger())
			r.config = tt.config

			got := r.GetHeartbeatInterval()
			if got != tt.expected {
				t.Errorf("GetHeartbeatInterval() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// --- sanitizeName Tests ---

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "simple"},
		{"Simple", "simple"},
		{"UPPERCASE", "uppercase"},
		{"with spaces", "with-spaces"},
		{"with_underscores", "with-underscores"},
		{"Mixed Case Name", "mixed-case-name"},
		{"with-dashes", "with-dashes"},
		{"with123numbers", "with123numbers"},
		{"-starts-with-dash", "starts-with-dash"},
		{"ends-with-dash-", "ends-with-dash"},
		{"-both-ends-", "both-ends"},
		{"special!@#chars", "specialchars"},
		{"", ""},
		{"a", "a"},
		{"A", "a"},
		{"---", "-"},  // strips leading/trailing dash once each, leaves middle
		{"a-b-c", "a-b-c"},
		// Long name truncation (63 chars max)
		{"this-is-a-very-long-name-that-exceeds-the-kubernetes-maximum-of-63-characters-limit", "this-is-a-very-long-name-that-exceeds-the-kubernetes-maximum-of"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeName(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// --- setCondition Tests ---

func TestSetCondition(t *testing.T) {
	t.Run("adds new condition", func(t *testing.T) {
		conditions := []metav1.Condition{}
		newCond := metav1.Condition{
			Type:    "Ready",
			Status:  metav1.ConditionTrue,
			Reason:  "AllGood",
			Message: "Everything is ready",
		}

		setCondition(&conditions, newCond)

		if len(conditions) != 1 {
			t.Errorf("Expected 1 condition, got %d", len(conditions))
		}
		if conditions[0].Type != "Ready" {
			t.Errorf("Expected condition type 'Ready', got %q", conditions[0].Type)
		}
	})

	t.Run("updates existing condition", func(t *testing.T) {
		conditions := []metav1.Condition{
			{
				Type:    "Ready",
				Status:  metav1.ConditionFalse,
				Reason:  "NotReady",
				Message: "Not ready yet",
			},
		}
		newCond := metav1.Condition{
			Type:    "Ready",
			Status:  metav1.ConditionTrue,
			Reason:  "AllGood",
			Message: "Now ready",
		}

		setCondition(&conditions, newCond)

		if len(conditions) != 1 {
			t.Errorf("Expected 1 condition, got %d", len(conditions))
		}
		if conditions[0].Status != metav1.ConditionTrue {
			t.Error("Expected condition status to be updated to True")
		}
		if conditions[0].Message != "Now ready" {
			t.Errorf("Expected message 'Now ready', got %q", conditions[0].Message)
		}
	})

	t.Run("adds second condition type", func(t *testing.T) {
		conditions := []metav1.Condition{
			{Type: "Ready", Status: metav1.ConditionTrue},
		}
		newCond := metav1.Condition{
			Type:   "Healthy",
			Status: metav1.ConditionTrue,
		}

		setCondition(&conditions, newCond)

		if len(conditions) != 2 {
			t.Errorf("Expected 2 conditions, got %d", len(conditions))
		}
	})
}

// --- getAPIToken Tests ---

func TestGetAPIToken(t *testing.T) {
	t.Run("success with explicit namespace", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-token-secret",
				Namespace: "custom-ns",
			},
			Data: map[string][]byte{
				"token": []byte("my-api-token"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name:      "api-token-secret",
					Key:       "token",
					Namespace: "custom-ns",
				},
			},
		}

		token, err := r.getAPIToken(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if token != "my-api-token" {
			t.Errorf("Expected token 'my-api-token', got %q", token)
		}
	})

	t.Run("success with default namespace", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-token-secret",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"token": []byte("my-api-token"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "api-token-secret",
					Key:  "token",
					// No namespace specified, should use config namespace
				},
			},
		}

		token, err := r.getAPIToken(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if token != "my-api-token" {
			t.Errorf("Expected token 'my-api-token', got %q", token)
		}
	})

	t.Run("secret not found", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "nonexistent-secret",
					Key:  "token",
				},
			},
		}

		_, err := r.getAPIToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing secret")
		}
	})

	t.Run("key not found in secret", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-token-secret",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"wrong-key": []byte("value"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "api-token-secret",
					Key:  "token",
				},
			},
		}

		_, err := r.getAPIToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing key")
		}
	})
}

// --- getClusterToken Tests ---

func TestGetClusterToken(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "policy-hub-cluster-token",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"api-token": []byte("cluster-token-123"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}

		token, err := r.getClusterToken(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if token != "cluster-token-123" {
			t.Errorf("Expected token 'cluster-token-123', got %q", token)
		}
	})

	t.Run("secret not found", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}

		_, err := r.getClusterToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing secret")
		}
	})

	t.Run("key not found", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "policy-hub-cluster-token",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"wrong-key": []byte("value"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}

		_, err := r.getClusterToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing key")
		}
	})
}

// --- getRegistrationToken Tests ---

func TestGetRegistrationToken(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "registration-token-secret",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"reg-token": []byte("registration-token-abc"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				RegistrationTokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "registration-token-secret",
					Key:  "reg-token",
				},
			},
		}

		token, err := r.getRegistrationToken(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if token != "registration-token-abc" {
			t.Errorf("Expected token 'registration-token-abc', got %q", token)
		}
	})

	t.Run("nil secret ref", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				RegistrationTokenSecretRef: nil,
			},
		}

		_, err := r.getRegistrationToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for nil secret ref")
		}
	})

	t.Run("secret not found", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				RegistrationTokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "nonexistent",
					Key:  "token",
				},
			},
		}

		_, err := r.getRegistrationToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing secret")
		}
	})

	t.Run("key not found", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "registration-token-secret",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"wrong-key": []byte("value"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				RegistrationTokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "registration-token-secret",
					Key:  "token",
				},
			},
		}

		_, err := r.getRegistrationToken(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing key")
		}
	})
}

// --- getClusterInfo Tests ---

func TestGetClusterInfo(t *testing.T) {
	t.Run("with nodes and namespaces", func(t *testing.T) {
		node := &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
			Status: corev1.NodeStatus{
				NodeInfo: corev1.NodeSystemInfo{
					KubeletVersion: "v1.28.0",
				},
			},
		}
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: "default"},
		}
		c := newFakeClient(node, ns)
		r := NewReconciler(c, testLogger())

		nodeCount, nsCount, k8sVersion := r.getClusterInfo(context.Background())

		if nodeCount != 1 {
			t.Errorf("Expected nodeCount 1, got %d", nodeCount)
		}
		if nsCount != 1 {
			t.Errorf("Expected nsCount 1, got %d", nsCount)
		}
		if k8sVersion != "v1.28.0" {
			t.Errorf("Expected k8sVersion 'v1.28.0', got %q", k8sVersion)
		}
	})

	t.Run("with no nodes", func(t *testing.T) {
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: "default"},
		}
		c := newFakeClient(ns)
		r := NewReconciler(c, testLogger())

		nodeCount, nsCount, k8sVersion := r.getClusterInfo(context.Background())

		if nodeCount != 0 {
			t.Errorf("Expected nodeCount 0, got %d", nodeCount)
		}
		if nsCount != 1 {
			t.Errorf("Expected nsCount 1, got %d", nsCount)
		}
		if k8sVersion != "" {
			t.Errorf("Expected empty k8sVersion, got %q", k8sVersion)
		}
	})

	t.Run("with multiple nodes", func(t *testing.T) {
		node1 := &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
			Status: corev1.NodeStatus{
				NodeInfo: corev1.NodeSystemInfo{
					KubeletVersion: "v1.28.0",
				},
			},
		}
		node2 := &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-2"},
			Status: corev1.NodeStatus{
				NodeInfo: corev1.NodeSystemInfo{
					KubeletVersion: "v1.28.0",
				},
			},
		}
		c := newFakeClient(node1, node2)
		r := NewReconciler(c, testLogger())

		nodeCount, _, _ := r.getClusterInfo(context.Background())

		if nodeCount != 2 {
			t.Errorf("Expected nodeCount 2, got %d", nodeCount)
		}
	})
}

// --- Initialize Tests ---

func TestInitialize(t *testing.T) {
	t.Run("legacy mode with API token", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-token",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"token": []byte("test-api-token"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				SaaSEndpoint: "https://api.example.com",
				ClusterID:    "cluster-123",
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "api-token",
					Key:  "token",
				},
			},
		}

		err := r.Initialize(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if r.saasClient == nil {
			t.Error("Expected saasClient to be set")
		}
		if r.deployer == nil {
			t.Error("Expected deployer to be set")
		}
	})

	t.Run("legacy mode missing API token secret ref", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				SaaSEndpoint: "https://api.example.com",
				ClusterID:    "cluster-123",
				// Missing APITokenSecretRef
			},
		}

		err := r.Initialize(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing APITokenSecretRef")
		}
	})

	t.Run("legacy mode API token secret not found", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				SaaSEndpoint: "https://api.example.com",
				ClusterID:    "cluster-123",
				APITokenSecretRef: &policyv1alpha1.SecretKeySelector{
					Name: "nonexistent",
					Key:  "token",
				},
			},
		}

		err := r.Initialize(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing secret")
		}
	})

	t.Run("bootstrapped state with cluster token", func(t *testing.T) {
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "policy-hub-cluster-token",
				Namespace: "default",
			},
			Data: map[string][]byte{
				"api-token": []byte("cluster-token"),
			},
		}
		c := newFakeClient(secret)
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				SaaSEndpoint: "https://api.example.com",
			},
			Status: policyv1alpha1.PolicyHubConfigStatus{
				Bootstrapped: true,
				ClusterID:    "cluster-abc",
				OperatorID:   "op-123",
			},
		}

		err := r.Initialize(context.Background(), config)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if r.saasClient == nil {
			t.Error("Expected saasClient to be set")
		}
		if !r.registered {
			t.Error("Expected registered to be true")
		}
		if r.operatorID != "op-123" {
			t.Errorf("Expected operatorID 'op-123', got %q", r.operatorID)
		}
	})

	t.Run("bootstrapped state missing cluster token", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
			Spec: policyv1alpha1.PolicyHubConfigSpec{
				SaaSEndpoint: "https://api.example.com",
			},
			Status: policyv1alpha1.PolicyHubConfigStatus{
				Bootstrapped: true,
				ClusterID:    "cluster-abc",
			},
		}

		err := r.Initialize(context.Background(), config)
		if err == nil {
			t.Error("Expected error for missing cluster token")
		}
	})
}

// --- Register Tests ---

func TestRegister(t *testing.T) {
	t.Run("already registered", func(t *testing.T) {
		c := newFakeClient()
		r := NewReconciler(c, testLogger())
		r.registered = true

		err := r.Register(context.Background())
		if err != nil {
			t.Errorf("Expected no error for already registered, got: %v", err)
		}
	})

	t.Run("successful registration", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/operator/register" {
				resp := saas.RegisterResponse{
					Success:     true,
					OperatorID:  "op-123",
					ClusterName: "test-cluster",
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
			http.NotFound(w, r)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.Register(context.Background())
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if !r.registered {
			t.Error("Expected registered to be true")
		}
		if r.operatorID != "op-123" {
			t.Errorf("Expected operatorID 'op-123', got %q", r.operatorID)
		}
	})

	t.Run("registration fails", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		c := newFakeClient()
		r := NewReconciler(c, testLogger())
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.Register(context.Background())
		if err == nil {
			t.Error("Expected error for failed registration")
		}
		if r.registered {
			t.Error("Expected registered to be false after failure")
		}
	})
}

// --- SendHeartbeat Tests ---

func TestSendHeartbeat(t *testing.T) {
	t.Run("successful heartbeat", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/operator/heartbeat" {
				resp := saas.HeartbeatResponse{
					Success:              true,
					PendingPoliciesCount: 5,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
			http.NotFound(w, r)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SendHeartbeat(context.Background())
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if r.lastHeartbeat.IsZero() {
			t.Error("Expected lastHeartbeat to be set")
		}
	})

	t.Run("heartbeat fails", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SendHeartbeat(context.Background())
		if err == nil {
			t.Error("Expected error for failed heartbeat")
		}
	})
}

// --- SyncPolicies Tests ---

func TestSyncPolicies(t *testing.T) {
	t.Run("fetch policies fails", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SyncPolicies(context.Background())
		if err == nil {
			t.Error("Expected error for failed fetch")
		}
	})

	t.Run("sync with no policies", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/operator/policies" {
				resp := saas.FetchPoliciesResponse{
					Success:  true,
					Policies: []saas.Policy{},
					Count:    0,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
			http.NotFound(w, r)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SyncPolicies(context.Background())
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}
		if r.lastSync.IsZero() {
			t.Error("Expected lastSync to be set")
		}
	})

	t.Run("sync creates new policy", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/operator/policies" {
				resp := saas.FetchPoliciesResponse{
					Success: true,
					Policies: []saas.Policy{
						{
							ID:               "policy-1",
							Name:             "Test Policy",
							Description:      "A test policy",
							Type:             "CILIUM_NETWORK",
							Content:          "apiVersion: cilium.io/v2\nkind: CiliumNetworkPolicy",
							TargetNamespaces: []string{"default"},
							Version:          1,
						},
					},
					Count: 1,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
			http.NotFound(w, r)
		}))
		defer server.Close()

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SyncPolicies(context.Background())
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		// Verify ManagedPolicy was created
		policyList := &policyv1alpha1.ManagedPolicyList{}
		if err := c.List(context.Background(), policyList); err != nil {
			t.Fatalf("Failed to list policies: %v", err)
		}
		if len(policyList.Items) != 1 {
			t.Errorf("Expected 1 policy, got %d", len(policyList.Items))
		}
	})

	t.Run("sync updates existing policy", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/operator/policies" {
				resp := saas.FetchPoliciesResponse{
					Success: true,
					Policies: []saas.Policy{
						{
							ID:               "policy-1",
							Name:             "Updated Policy",
							Description:      "Updated description",
							Type:             "CILIUM_NETWORK",
							Content:          "apiVersion: cilium.io/v2\nkind: CiliumNetworkPolicy\nmetadata:\n  name: updated",
							TargetNamespaces: []string{"default", "kube-system"},
							Version:          2,
						},
					},
					Count: 1,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
			http.NotFound(w, r)
		}))
		defer server.Close()

		// Create existing policy with lower version
		existingPolicy := &policyv1alpha1.ManagedPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-policy",
				Namespace: "default",
			},
			Spec: policyv1alpha1.ManagedPolicySpec{
				PolicyID:    "policy-1",
				Name:        "Test Policy",
				Description: "Original description",
				PolicyType:  policyv1alpha1.PolicyTypeCiliumNetwork,
				Content:     "original content",
				Version:     1,
			},
		}

		config := &policyv1alpha1.PolicyHubConfig{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "config",
				Namespace: "default",
			},
		}
		c := newFakeClient(config, existingPolicy)
		r := NewReconciler(c, testLogger())
		r.config = config
		r.saasClient = saas.NewClient(server.URL, "test-token", "cluster-id", testLogger())

		err := r.SyncPolicies(context.Background())
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		// Verify policy was updated
		updatedPolicy := &policyv1alpha1.ManagedPolicy{}
		if err := c.Get(context.Background(), client.ObjectKey{Name: "test-policy", Namespace: "default"}, updatedPolicy); err != nil {
			t.Fatalf("Failed to get policy: %v", err)
		}
		if updatedPolicy.Spec.Version != 2 {
			t.Errorf("Expected version 2, got %d", updatedPolicy.Spec.Version)
		}
		if updatedPolicy.Spec.Description != "Updated description" {
			t.Errorf("Expected updated description, got %q", updatedPolicy.Spec.Description)
		}
	})
}

// --- updatePolicyStatus Tests ---

func TestUpdatePolicyStatus(t *testing.T) {
	t.Run("updates status successfully", func(t *testing.T) {
		policy := &policyv1alpha1.ManagedPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-policy",
				Namespace: "default",
			},
			Spec: policyv1alpha1.ManagedPolicySpec{
				PolicyID: "policy-1",
				Name:     "Test Policy",
			},
		}
		c := newFakeClient(policy)
		r := NewReconciler(c, testLogger())

		err := r.updatePolicyStatus(context.Background(), policy, policyv1alpha1.ManagedPolicyPhaseDeploying, "")
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		// Verify status was updated
		updatedPolicy := &policyv1alpha1.ManagedPolicy{}
		if err := c.Get(context.Background(), client.ObjectKey{Name: "test-policy", Namespace: "default"}, updatedPolicy); err != nil {
			t.Fatalf("Failed to get policy: %v", err)
		}
		if updatedPolicy.Status.Phase != policyv1alpha1.ManagedPolicyPhaseDeploying {
			t.Errorf("Expected phase Deploying, got %s", updatedPolicy.Status.Phase)
		}
	})

	t.Run("updates status with error message", func(t *testing.T) {
		policy := &policyv1alpha1.ManagedPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-policy",
				Namespace: "default",
			},
			Spec: policyv1alpha1.ManagedPolicySpec{
				PolicyID: "policy-1",
				Name:     "Test Policy",
			},
		}
		c := newFakeClient(policy)
		r := NewReconciler(c, testLogger())

		err := r.updatePolicyStatus(context.Background(), policy, policyv1alpha1.ManagedPolicyPhaseFailed, "deployment failed")
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		// Verify status was updated
		updatedPolicy := &policyv1alpha1.ManagedPolicy{}
		if err := c.Get(context.Background(), client.ObjectKey{Name: "test-policy", Namespace: "default"}, updatedPolicy); err != nil {
			t.Fatalf("Failed to get policy: %v", err)
		}
		if updatedPolicy.Status.Phase != policyv1alpha1.ManagedPolicyPhaseFailed {
			t.Errorf("Expected phase Failed, got %s", updatedPolicy.Status.Phase)
		}
		if updatedPolicy.Status.LastError != "deployment failed" {
			t.Errorf("Expected error message 'deployment failed', got %q", updatedPolicy.Status.LastError)
		}
	})
}

// --- Constants Tests ---

func TestConstants(t *testing.T) {
	if OperatorVersion == "" {
		t.Error("OperatorVersion should not be empty")
	}
	if ConditionTypeRegistered != "Registered" {
		t.Errorf("Expected ConditionTypeRegistered 'Registered', got %q", ConditionTypeRegistered)
	}
	if ConditionTypeSynced != "Synced" {
		t.Errorf("Expected ConditionTypeSynced 'Synced', got %q", ConditionTypeSynced)
	}
	if ConditionTypeHealthy != "Healthy" {
		t.Errorf("Expected ConditionTypeHealthy 'Healthy', got %q", ConditionTypeHealthy)
	}
}
