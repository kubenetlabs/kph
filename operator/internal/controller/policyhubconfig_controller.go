package controller

import (
	"context"
	stdsync "sync"
	"time"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
	"github.com/policy-hub/operator/internal/sync"
)

// PolicyHubConfigReconciler reconciles a PolicyHubConfig object
type PolicyHubConfigReconciler struct {
	client.Client
	Scheme            *runtime.Scheme
	Log               logr.Logger
	Reconciler        *sync.Reconciler
	syncTicker        *time.Ticker
	hbTicker          *time.Ticker
	stopChan          chan struct{}
	lastReconcileSync time.Time      // Track last sync from Reconcile to avoid redundant syncs
	syncMu            stdsync.Mutex  // Protects lastReconcileSync
}

// +kubebuilder:rbac:groups=policyhub.io,resources=policyhubconfigs,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=policyhub.io,resources=policyhubconfigs/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=policyhub.io,resources=policyhubconfigs/finalizers,verbs=update
// +kubebuilder:rbac:groups=policyhub.io,resources=managedpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=policyhub.io,resources=managedpolicies/status,verbs=get;update;patch
// +kubebuilder:rbac:groups="",resources=secrets,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=nodes,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=namespaces,verbs=get;list;watch
// +kubebuilder:rbac:groups=cilium.io,resources=ciliumnetworkpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=cilium.io,resources=ciliumclusterwidenetworkpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=cilium.io,resources=tracingpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=httproutes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=grpcroutes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=tcproutes,verbs=get;list;watch;create;update;patch;delete

// Reconcile handles PolicyHubConfig reconciliation
func (r *PolicyHubConfigReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("policyhubconfig", req.NamespacedName)

	// Fetch the PolicyHubConfig
	config := &policyv1alpha1.PolicyHubConfig{}
	if err := r.Get(ctx, req.NamespacedName, config); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	log.Info("Reconciling PolicyHubConfig")

	// Initialize reconciler if not done
	if err := r.Reconciler.Initialize(ctx, config); err != nil {
		log.Error(err, "Failed to initialize reconciler")
		return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
	}

	// Register if not registered (only happens for non-bootstrap flow)
	if !r.Reconciler.IsRegistered() {
		if err := r.Reconciler.Register(ctx); err != nil {
			log.Error(err, "Failed to register with SaaS platform")
			return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
		}
	}

	// Start background tasks if not already running
	// This handles both fresh registration and restarts where we restored from bootstrapped state
	r.startBackgroundTasks()

	// Only trigger sync if we haven't synced recently (avoid redundant syncs when
	// background tasks are already running). Always sync on first reconcile.
	syncInterval := r.Reconciler.GetSyncInterval()
	r.syncMu.Lock()
	shouldSync := r.lastReconcileSync.IsZero() || time.Since(r.lastReconcileSync) > syncInterval/2
	if shouldSync {
		r.lastReconcileSync = time.Now()
	}
	r.syncMu.Unlock()

	if shouldSync {
		if err := r.Reconciler.SyncPolicies(ctx); err != nil {
			log.Error(err, "Failed to sync policies")
			return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
		}
	} else {
		log.V(1).Info("Skipping sync, recent sync already performed")
	}

	return ctrl.Result{}, nil
}

// startBackgroundTasks starts the sync and heartbeat goroutines
// Uses context.Background() since these tasks run for the lifetime of the operator
func (r *PolicyHubConfigReconciler) startBackgroundTasks() {
	if r.stopChan != nil {
		return // Already running
	}

	r.stopChan = make(chan struct{})

	// Use background context for long-running tasks
	bgCtx := context.Background()

	// Start sync ticker
	syncInterval := r.Reconciler.GetSyncInterval()
	r.syncTicker = time.NewTicker(syncInterval)

	go func() {
		for {
			select {
			case <-r.syncTicker.C:
				// Update lastReconcileSync to coordinate with controller's Reconcile
				r.syncMu.Lock()
				r.lastReconcileSync = time.Now()
				r.syncMu.Unlock()

				if err := r.Reconciler.SyncPolicies(bgCtx); err != nil {
					r.Log.Error(err, "Background sync failed")
				}
			case <-r.stopChan:
				r.syncTicker.Stop()
				return
			}
		}
	}()

	// Start heartbeat ticker
	hbInterval := r.Reconciler.GetHeartbeatInterval()
	r.hbTicker = time.NewTicker(hbInterval)

	go func() {
		// Send initial heartbeat
		if err := r.Reconciler.SendHeartbeat(bgCtx); err != nil {
			r.Log.Error(err, "Initial heartbeat failed")
		}

		for {
			select {
			case <-r.hbTicker.C:
				if err := r.Reconciler.SendHeartbeat(bgCtx); err != nil {
					r.Log.Error(err, "Heartbeat failed")
				}
			case <-r.stopChan:
				r.hbTicker.Stop()
				return
			}
		}
	}()

	r.Log.Info("Started background tasks",
		"syncInterval", syncInterval,
		"heartbeatInterval", hbInterval)
}

// SetupWithManager sets up the controller with the Manager
func (r *PolicyHubConfigReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&policyv1alpha1.PolicyHubConfig{}).
		Complete(r)
}
