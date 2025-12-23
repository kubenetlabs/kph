package controller

import (
	"context"
	"testing"
	"time"

	"github.com/go-logr/logr"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
	"github.com/policy-hub/operator/internal/sync"
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

// --- ManagedPolicyReconciler Tests ---

func TestManagedPolicyReconciler_Reconcile_NotFound(t *testing.T) {
	// Test when ManagedPolicy doesn't exist
	c := newFakeClient()
	r := &ManagedPolicyReconciler{
		Client: c,
		Scheme: testScheme(),
		Log:    testLogger(),
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "nonexistent",
			Namespace: "default",
		},
	})

	if err != nil {
		t.Errorf("Expected no error for not found, got: %v", err)
	}
	if result.Requeue || result.RequeueAfter != 0 {
		t.Error("Expected no requeue for not found")
	}
}

func TestManagedPolicyReconciler_Reconcile_ReconcilerNil(t *testing.T) {
	// Test when Reconciler is nil
	mp := &policyv1alpha1.ManagedPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-policy",
			Namespace: "default",
		},
		Spec: policyv1alpha1.ManagedPolicySpec{
			PolicyID: "policy-123",
			Name:     "Test Policy",
		},
	}

	c := newFakeClient(mp)
	r := &ManagedPolicyReconciler{
		Client:     c,
		Scheme:     testScheme(),
		Log:        testLogger(),
		Reconciler: nil, // nil reconciler
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test-policy",
			Namespace: "default",
		},
	})

	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	if result.RequeueAfter != 10*time.Second {
		t.Errorf("Expected RequeueAfter 10s, got: %v", result.RequeueAfter)
	}
}

func TestManagedPolicyReconciler_Reconcile_ReconcilerNotRegistered(t *testing.T) {
	// Test when Reconciler exists but is not registered
	mp := &policyv1alpha1.ManagedPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-policy",
			Namespace: "default",
		},
		Spec: policyv1alpha1.ManagedPolicySpec{
			PolicyID: "policy-123",
			Name:     "Test Policy",
		},
	}

	c := newFakeClient(mp)
	syncReconciler := sync.NewReconciler(c, testLogger())

	r := &ManagedPolicyReconciler{
		Client:     c,
		Scheme:     testScheme(),
		Log:        testLogger(),
		Reconciler: syncReconciler, // not registered
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test-policy",
			Namespace: "default",
		},
	})

	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	if result.RequeueAfter != 10*time.Second {
		t.Errorf("Expected RequeueAfter 10s, got: %v", result.RequeueAfter)
	}
}

func TestManagedPolicyReconciler_Reconcile_Deleting(t *testing.T) {
	// Test when ManagedPolicy is being deleted - reconciler not registered case
	// When reconciler is not registered, it requeues even for deleting policies
	now := metav1.Now()
	mp := &policyv1alpha1.ManagedPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-policy",
			Namespace:         "default",
			DeletionTimestamp: &now,
			Finalizers:        []string{"test-finalizer"}, // Required for deletion timestamp
		},
		Spec: policyv1alpha1.ManagedPolicySpec{
			PolicyID: "policy-123",
			Name:     "Test Policy",
		},
	}

	c := newFakeClient(mp)
	// Use real sync.Reconciler - it won't be registered
	syncReconciler := sync.NewReconciler(c, testLogger())

	r := &ManagedPolicyReconciler{
		Client:     c,
		Scheme:     testScheme(),
		Log:        testLogger(),
		Reconciler: syncReconciler,
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test-policy",
			Namespace: "default",
		},
	})

	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	// Should requeue because reconciler is not registered
	if result.RequeueAfter != 10*time.Second {
		t.Errorf("Expected RequeueAfter 10s (not registered), got: %v", result.RequeueAfter)
	}
}

// --- PolicyHubConfigReconciler Tests ---

func TestPolicyHubConfigReconciler_Reconcile_NotFound(t *testing.T) {
	// Test when PolicyHubConfig doesn't exist
	c := newFakeClient()
	r := &PolicyHubConfigReconciler{
		Client: c,
		Scheme: testScheme(),
		Log:    testLogger(),
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "nonexistent",
			Namespace: "default",
		},
	})

	if err != nil {
		t.Errorf("Expected no error for not found, got: %v", err)
	}
	if result.Requeue || result.RequeueAfter != 0 {
		t.Error("Expected no requeue for not found")
	}
}

func TestPolicyHubConfigReconciler_Reconcile_InitializeFails(t *testing.T) {
	// Test when Initialize fails
	config := &policyv1alpha1.PolicyHubConfig{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-config",
			Namespace: "default",
		},
		Spec: policyv1alpha1.PolicyHubConfigSpec{
			SaaSEndpoint: "https://api.example.com",
			ClusterID:    "cluster-123",
			// Missing APITokenSecretRef - should cause Initialize to fail
		},
	}

	c := newFakeClient(config)
	syncReconciler := sync.NewReconciler(c, testLogger())

	r := &PolicyHubConfigReconciler{
		Client:     c,
		Scheme:     testScheme(),
		Log:        testLogger(),
		Reconciler: syncReconciler,
	}

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test-config",
			Namespace: "default",
		},
	})

	// Initialize should fail because APITokenSecretRef is not set
	if err != nil {
		t.Errorf("Expected no error (should requeue), got: %v", err)
	}
	if result.RequeueAfter != 30*time.Second {
		t.Errorf("Expected RequeueAfter 30s, got: %v", result.RequeueAfter)
	}
}

func TestPolicyHubConfigReconciler_startBackgroundTasks_AlreadyRunning(t *testing.T) {
	// Test that startBackgroundTasks doesn't start twice
	c := newFakeClient()
	syncReconciler := sync.NewReconciler(c, testLogger())

	r := &PolicyHubConfigReconciler{
		Client:     c,
		Scheme:     testScheme(),
		Log:        testLogger(),
		Reconciler: syncReconciler,
		stopChan:   make(chan struct{}), // Already has stopChan set
	}

	// This should not create new tickers since stopChan already exists
	r.startBackgroundTasks()

	// Verify that stopChan is still the original (not replaced)
	if r.syncTicker != nil {
		t.Error("Expected syncTicker to not be set when stopChan already exists")
	}
}

func TestPolicyHubConfigReconciler_InitialState(t *testing.T) {
	// Test that PolicyHubConfigReconciler has correct initial state
	c := newFakeClient()

	r := &PolicyHubConfigReconciler{
		Client: c,
		Scheme: testScheme(),
		Log:    testLogger(),
	}

	// Verify initial state
	if r.stopChan != nil {
		t.Error("Expected stopChan to be nil initially")
	}
	if r.syncTicker != nil {
		t.Error("Expected syncTicker to be nil initially")
	}
	if r.hbTicker != nil {
		t.Error("Expected hbTicker to be nil initially")
	}
}

// --- Request/Result Tests ---

func TestReconcileRequest(t *testing.T) {
	// Test that reconcile.Request works correctly
	req := reconcile.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test",
			Namespace: "default",
		},
	}

	if req.Name != "test" {
		t.Errorf("Expected name 'test', got '%s'", req.Name)
	}
	if req.Namespace != "default" {
		t.Errorf("Expected namespace 'default', got '%s'", req.Namespace)
	}
}

func TestReconcileResult(t *testing.T) {
	tests := []struct {
		name         string
		result       ctrl.Result
		wantRequeue  bool
		wantAfter    time.Duration
	}{
		{
			name:         "no requeue",
			result:       ctrl.Result{},
			wantRequeue:  false,
			wantAfter:    0,
		},
		{
			name:         "requeue immediately",
			result:       ctrl.Result{Requeue: true},
			wantRequeue:  true,
			wantAfter:    0,
		},
		{
			name:         "requeue after 10s",
			result:       ctrl.Result{RequeueAfter: 10 * time.Second},
			wantRequeue:  false,
			wantAfter:    10 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.result.Requeue != tt.wantRequeue {
				t.Errorf("Requeue = %v, want %v", tt.result.Requeue, tt.wantRequeue)
			}
			if tt.result.RequeueAfter != tt.wantAfter {
				t.Errorf("RequeueAfter = %v, want %v", tt.result.RequeueAfter, tt.wantAfter)
			}
		})
	}
}

// --- Struct Field Tests ---

func TestManagedPolicyReconciler_Fields(t *testing.T) {
	c := newFakeClient()
	scheme := testScheme()
	log := testLogger()

	r := &ManagedPolicyReconciler{
		Client: c,
		Scheme: scheme,
		Log:    log,
	}

	if r.Client == nil {
		t.Error("Expected Client to be set")
	}
	if r.Scheme == nil {
		t.Error("Expected Scheme to be set")
	}
}

func TestPolicyHubConfigReconciler_Fields(t *testing.T) {
	c := newFakeClient()
	scheme := testScheme()
	log := testLogger()

	r := &PolicyHubConfigReconciler{
		Client: c,
		Scheme: scheme,
		Log:    log,
	}

	if r.Client == nil {
		t.Error("Expected Client to be set")
	}
	if r.Scheme == nil {
		t.Error("Expected Scheme to be set")
	}
}
