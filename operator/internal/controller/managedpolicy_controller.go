package controller

import (
	"context"
	"time"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	policyv1alpha1 "github.com/policy-hub/operator/api/v1alpha1"
	"github.com/policy-hub/operator/internal/sync"
)

// ManagedPolicyReconciler reconciles a ManagedPolicy object
type ManagedPolicyReconciler struct {
	client.Client
	Scheme     *runtime.Scheme
	Log        logr.Logger
	Reconciler *sync.Reconciler
}

// +kubebuilder:rbac:groups=policyhub.io,resources=managedpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=policyhub.io,resources=managedpolicies/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=policyhub.io,resources=managedpolicies/finalizers,verbs=update

// Reconcile handles ManagedPolicy reconciliation
func (r *ManagedPolicyReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("managedpolicy", req.NamespacedName)

	// Fetch the ManagedPolicy
	mp := &policyv1alpha1.ManagedPolicy{}
	if err := r.Get(ctx, req.NamespacedName, mp); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// Skip if reconciler not initialized
	if r.Reconciler == nil || !r.Reconciler.IsRegistered() {
		log.V(1).Info("Reconciler not ready, requeueing")
		return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
	}

	// Handle deletion
	if !mp.DeletionTimestamp.IsZero() {
		log.Info("ManagedPolicy being deleted")
		return ctrl.Result{}, nil
	}

	// Reconcile the policy
	if err := r.Reconciler.ReconcilePolicy(ctx, mp); err != nil {
		log.Error(err, "Failed to reconcile policy")
		return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
	}

	return ctrl.Result{}, nil
}

// SetupWithManager sets up the controller with the Manager
func (r *ManagedPolicyReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&policyv1alpha1.ManagedPolicy{}).
		Complete(r)
}
