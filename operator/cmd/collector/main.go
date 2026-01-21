// Package main is the entrypoint for the Policy Hub telemetry collector DaemonSet.
// The collector runs on each node and streams telemetry from Hubble and Tetragon,
// storing events locally and sending aggregated summaries to the SaaS platform.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-logr/logr"
	"github.com/go-logr/zapr"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	ciliumv2 "github.com/cilium/cilium/pkg/k8s/apis/cilium.io/v2"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/policy-hub/operator/internal/saas"
	"github.com/policy-hub/operator/internal/telemetry/aggregator"
	"github.com/policy-hub/operator/internal/telemetry/collector"
	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/query"
	"github.com/policy-hub/operator/internal/telemetry/simulation"
	"github.com/policy-hub/operator/internal/telemetry/storage"
	"github.com/policy-hub/operator/internal/telemetry/validation"
)

const (
	defaultHubbleAddress      = "hubble-relay.kube-system.svc.cluster.local:4245"
	defaultTetragonAddress    = "unix:///var/run/tetragon/tetragon.sock"
	defaultStoragePath        = "/var/lib/policyhub/telemetry"
	defaultBufferSize         = 10000
	defaultFlushInterval      = 30 * time.Second
	defaultRetentionDays      = 7
	defaultHealthPort         = 8080
	defaultMetricsPort        = 9090
	defaultQueryPort          = 9091
)

// Config holds the collector configuration.
type Config struct {
	// Hubble configuration
	HubbleAddress   string
	HubbleEnabled   bool

	// Tetragon configuration
	TetragonAddress string
	TetragonEnabled bool

	// Storage configuration
	StoragePath    string
	RetentionDays  int
	MaxStorageGB   int

	// Buffer configuration
	BufferSize     int
	FlushInterval  time.Duration

	// SaaS configuration
	SaaSEnabled       bool
	SaaSEndpoint      string
	SaaSAPIKey        string
	AggregationWindow time.Duration

	// Node information
	NodeName    string
	ClusterID   string

	// Server configuration
	HealthPort  int
	MetricsPort int
	QueryPort   int

	// Query API configuration
	QueryEnabled bool
	QueryAPIKey  string

	// Simulation configuration
	SimulationEnabled      bool
	SimulationPollInterval time.Duration

	// Validation configuration
	ValidationEnabled      bool
	ValidationFlushInterval time.Duration
	ValidationPolicyRefresh time.Duration
	ValidationEventBuffer   int
	ValidationSampleRate    int

	// Namespace filtering
	NamespaceFilter []string

	// Logging
	LogLevel string
}

func main() {
	cfg := parseFlags()

	// Initialize logger
	log, err := initLogger(cfg.LogLevel)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}

	log.Info("Starting Policy Hub Telemetry Collector",
		"nodeName", cfg.NodeName,
		"hubbleAddress", cfg.HubbleAddress,
		"tetragonAddress", cfg.TetragonAddress,
		"storagePath", cfg.StoragePath,
	)

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigChan
		log.Info("Received shutdown signal", "signal", sig)
		cancel()
	}()

	// Initialize storage manager
	storageMgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath:      cfg.StoragePath,
		NodeName:      cfg.NodeName,
		RetentionDays: cfg.RetentionDays,
		MaxStorageGB:  int64(cfg.MaxStorageGB),
		Logger:        log,
	})
	if err != nil {
		log.Error(err, "Failed to initialize storage manager")
		os.Exit(1)
	}
	defer storageMgr.Close()

	// Start storage manager (retention worker, etc.)
	if err := storageMgr.Start(ctx); err != nil {
		log.Error(err, "Failed to start storage manager")
		os.Exit(1)
	}

	// Initialize and start query server for SaaS→Collector queries
	var queryServer *query.Server
	if cfg.QueryEnabled {
		queryServer = query.NewServer(query.ServerConfig{
			StorageManager: storageMgr,
			APIKey:         cfg.QueryAPIKey,
			Logger:         log,
		})

		queryAddress := fmt.Sprintf(":%d", cfg.QueryPort)
		if err := queryServer.Start(ctx, queryAddress); err != nil {
			log.Error(err, "Failed to start query server")
			os.Exit(1)
		}
		defer queryServer.Stop()

		log.Info("Query server enabled",
			"port", cfg.QueryPort,
			"authenticated", cfg.QueryAPIKey != "",
		)
	} else {
		log.Info("Query server disabled")
	}

	// Initialize ring buffer
	buffer := collector.NewRingBuffer(collector.RingBufferConfig{
		Size:           cfg.BufferSize,
		FlushInterval:  cfg.FlushInterval,
		FlushThreshold: 0.8,
		Logger:         log,
	})

	// Set up flush handler to write to storage
	buffer.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		if err := storageMgr.Write(events); err != nil {
			log.Error(err, "Failed to write events to storage", "count", len(events))
			return err
		}
		log.V(1).Info("Flushed events to storage", "count", len(events))
		return nil
	})

	// Start buffer flush worker
	go buffer.StartFlushWorker(ctx)

	// Initialize SaaS sender for aggregated telemetry
	var saasSender *aggregator.SaaSSender
	if cfg.SaaSEnabled && cfg.SaaSEndpoint != "" {
		saasSender = aggregator.NewSaaSSender(aggregator.SaaSSenderConfig{
			Endpoint:      cfg.SaaSEndpoint + "/api/operator/telemetry/aggregates",
			APIKey:        cfg.SaaSAPIKey,
			ClusterID:     cfg.ClusterID,
			SendInterval:  cfg.AggregationWindow,
			MaxRetries:    3,
			RetryInterval: 5 * time.Second,
			Timeout:       30 * time.Second,
			NodeName:      cfg.NodeName,
			Logger:        log,
		})

		// Start the SaaS sender
		go saasSender.Start(ctx)

		log.Info("SaaS sender enabled",
			"endpoint", cfg.SaaSEndpoint,
			"aggregationWindow", cfg.AggregationWindow,
		)
	} else {
		log.Info("SaaS sender disabled (no endpoint configured)")
	}

	// Initialize and start simulation worker
	var simWorker *simulation.Worker
	if cfg.SimulationEnabled && cfg.SaaSEnabled && cfg.SaaSEndpoint != "" {
		// Create SaaS client for simulation
		saasClient := saas.NewClient(cfg.SaaSEndpoint, cfg.SaaSAPIKey, cfg.ClusterID, log)

		// Create simulation engine
		simEngine := simulation.NewEngine(simulation.EngineConfig{
			StorageManager: storageMgr,
			Logger:         log,
		})

		// Create and start simulation worker
		simWorker = simulation.NewWorker(simulation.WorkerConfig{
			Engine:       simEngine,
			SaaSClient:   saasClient,
			PollInterval: cfg.SimulationPollInterval,
			Logger:       log,
		})

		if err := simWorker.Start(ctx); err != nil {
			log.Error(err, "Failed to start simulation worker")
		} else {
			log.Info("Simulation worker enabled",
				"pollInterval", cfg.SimulationPollInterval,
			)
		}
	} else {
		log.Info("Simulation worker disabled")
	}

	// Initialize and start validation agent
	var validationAgent *validation.Agent
	if cfg.ValidationEnabled && cfg.SaaSEnabled && cfg.SaaSEndpoint != "" {
		// Create Kubernetes client for fetching policies
		k8sConfig, err := rest.InClusterConfig()
		if err != nil {
			log.Error(err, "Failed to get in-cluster config for validation agent")
		} else {
			// Create scheme with core K8s types, Cilium, and Gateway API CRDs registered
			scheme := runtime.NewScheme()
			if err := clientgoscheme.AddToScheme(scheme); err != nil {
				log.Error(err, "Failed to register core Kubernetes types in scheme")
			}
			if err := ciliumv2.AddToScheme(scheme); err != nil {
				log.Error(err, "Failed to register Cilium types in scheme")
			}
			if err := gatewayv1.Install(scheme); err != nil {
				log.Error(err, "Failed to register Gateway API types in scheme")
			}

			k8sClient, err := client.New(k8sConfig, client.Options{Scheme: scheme})
			if err != nil {
				log.Error(err, "Failed to create Kubernetes client for validation agent")
			} else {
				// Create validation agent
				validationAgent = validation.NewAgent(validation.AgentOptions{
					Client:          k8sClient,
					SaaSEndpoint:    cfg.SaaSEndpoint,
					APIKey:          cfg.SaaSAPIKey,
					ClusterID:       cfg.ClusterID,
					FlushInterval:   cfg.ValidationFlushInterval,
					PolicyRefresh:   cfg.ValidationPolicyRefresh,
					EventBufferSize: cfg.ValidationEventBuffer,
					EventSampleRate: cfg.ValidationSampleRate,
					Logger:          log,
				})

				if err := validationAgent.Start(ctx); err != nil {
					log.Error(err, "Failed to start validation agent")
				} else {
					log.Info("Validation agent enabled",
						"flushInterval", cfg.ValidationFlushInterval,
						"policyRefresh", cfg.ValidationPolicyRefresh,
						"sampleRate", cfg.ValidationSampleRate,
					)
				}
			}
		}
	} else {
		log.Info("Validation agent disabled")
	}

	// Initialize process validation reporter (for Tetragon events)
	var processValidationReporter *validation.ProcessValidationReporter
	if cfg.ValidationEnabled && cfg.SaaSEnabled && cfg.SaaSEndpoint != "" {
		processValidationReporter = validation.NewProcessValidationReporter(validation.ProcessValidationReporterConfig{
			Endpoint:   cfg.SaaSEndpoint,
			APIKey:     cfg.SaaSAPIKey,
			ClusterID:  cfg.ClusterID,
			MaxEvents:  cfg.ValidationEventBuffer,
			SampleRate: cfg.ValidationSampleRate,
			Logger:     log,
		})

		// Start the process validation reporter flush loop
		go processValidationReporter.Start(ctx, cfg.ValidationFlushInterval)

		log.Info("Process validation reporter enabled",
			"endpoint", cfg.SaaSEndpoint,
			"flushInterval", cfg.ValidationFlushInterval,
			"sampleRate", cfg.ValidationSampleRate,
		)
	} else {
		log.Info("Process validation reporter disabled")
	}

	// Initialize and start Hubble client
	if cfg.HubbleEnabled {
		hubbleClient := collector.NewHubbleClient(collector.HubbleClientConfig{
			Address:         cfg.HubbleAddress,
			TLSEnabled:      false, // TODO: Add TLS support
			NodeName:        cfg.NodeName,
			NamespaceFilter: cfg.NamespaceFilter,
			Logger:          log,
		})

		hubbleClient.SetEventHandler(func(event *models.TelemetryEvent) {
			buffer.Push(event)
			// Also send to SaaS aggregator
			if saasSender != nil {
				saasSender.AddEvent(event)
			}
			// Also send to validation agent for policy matching
			if validationAgent != nil {
				validationAgent.ProcessEvent(event)
			}
		})

		go func() {
			if err := runHubbleCollector(ctx, hubbleClient, log); err != nil && ctx.Err() == nil {
				log.Error(err, "Hubble collector failed")
			}
		}()
	}

	// Initialize event normalizer
	normalizer := collector.NewEventNormalizer(cfg.NodeName)

	// Initialize and start Tetragon client
	if cfg.TetragonEnabled {
		tetragonClient := collector.NewTetragonClient(collector.TetragonClientConfig{
			Address:            cfg.TetragonAddress,
			NodeName:           cfg.NodeName,
			NamespaceFilter:    cfg.NamespaceFilter,
			CollectProcessExec: true,
			CollectProcessExit: true,
			CollectKprobes:     true,
			Logger:             log,
		})

		tetragonClient.SetEventHandler(func(event *models.TelemetryEvent) {
			// Normalize and enrich the event
			normalizer.NormalizeEvent(event)
			normalizer.EnrichProcessEvent(event)
			buffer.Push(event)
			// Also send to SaaS aggregator
			if saasSender != nil {
				saasSender.AddEvent(event)
			}
			// Also send to process validation reporter
			if processValidationReporter != nil {
				processValidationReporter.RecordTetragonEvent(event)
			}
		})

		go func() {
			if err := runTetragonCollector(ctx, tetragonClient, log); err != nil && ctx.Err() == nil {
				log.Error(err, "Tetragon collector failed")
			}
		}()
	}

	// Start health server
	go startHealthServer(cfg.HealthPort, buffer, storageMgr, log)

	// Start metrics server
	go startMetricsServer(cfg.MetricsPort, buffer, storageMgr, saasSender, queryServer, simWorker, validationAgent, log)

	// Wait for shutdown
	<-ctx.Done()

	log.Info("Collector shutting down")

	// Final flush of buffer
	if err := buffer.Flush(); err != nil {
		log.Error(err, "Final buffer flush failed")
	}

	// Final flush of storage
	if err := storageMgr.Flush(); err != nil {
		log.Error(err, "Final storage flush failed")
	}

	// Final flush of SaaS sender
	if saasSender != nil {
		if err := saasSender.ForceFlush(context.Background()); err != nil {
			log.Error(err, "Final SaaS sender flush failed")
		}
	}

	// Stop validation agent (triggers final flush)
	if validationAgent != nil {
		validationAgent.Stop()
	}

	log.Info("Collector stopped")
}

func parseFlags() *Config {
	cfg := &Config{}

	// Hubble flags
	flag.StringVar(&cfg.HubbleAddress, "hubble-address", getEnv("HUBBLE_ADDRESS", defaultHubbleAddress), "Hubble Relay address")
	flag.BoolVar(&cfg.HubbleEnabled, "hubble-enabled", getEnvBool("HUBBLE_ENABLED", true), "Enable Hubble collection")

	// Tetragon flags
	flag.StringVar(&cfg.TetragonAddress, "tetragon-address", getEnv("TETRAGON_ADDRESS", defaultTetragonAddress), "Tetragon gRPC address")
	flag.BoolVar(&cfg.TetragonEnabled, "tetragon-enabled", getEnvBool("TETRAGON_ENABLED", true), "Enable Tetragon collection")

	// Storage flags
	flag.StringVar(&cfg.StoragePath, "storage-path", getEnv("STORAGE_PATH", defaultStoragePath), "Path for telemetry storage")
	flag.IntVar(&cfg.RetentionDays, "retention-days", getEnvInt("RETENTION_DAYS", defaultRetentionDays), "Days to retain telemetry data")
	flag.IntVar(&cfg.MaxStorageGB, "max-storage-gb", getEnvInt("MAX_STORAGE_GB", 100), "Maximum storage in GB")

	// Buffer flags
	flag.IntVar(&cfg.BufferSize, "buffer-size", getEnvInt("BUFFER_SIZE", defaultBufferSize), "Ring buffer size")
	flag.DurationVar(&cfg.FlushInterval, "flush-interval", getEnvDuration("FLUSH_INTERVAL", defaultFlushInterval), "Flush interval")

	// SaaS flags
	flag.BoolVar(&cfg.SaaSEnabled, "saas-enabled", getEnvBool("SAAS_ENABLED", true), "Enable SaaS sync")
	flag.StringVar(&cfg.SaaSEndpoint, "saas-endpoint", getEnv("SAAS_ENDPOINT", ""), "SaaS API endpoint")
	flag.StringVar(&cfg.SaaSAPIKey, "saas-api-key", getEnv("SAAS_API_KEY", ""), "SaaS API key")
	flag.DurationVar(&cfg.AggregationWindow, "aggregation-window", getEnvDuration("AGGREGATION_WINDOW", time.Minute), "Aggregation window for SaaS sync")

	// Node info flags
	flag.StringVar(&cfg.NodeName, "node-name", getEnv("NODE_NAME", ""), "Node name (from downward API)")
	flag.StringVar(&cfg.ClusterID, "cluster-id", getEnv("CLUSTER_ID", ""), "Cluster ID")

	// Server flags
	flag.IntVar(&cfg.HealthPort, "health-port", getEnvInt("HEALTH_PORT", defaultHealthPort), "Health check port")
	flag.IntVar(&cfg.MetricsPort, "metrics-port", getEnvInt("METRICS_PORT", defaultMetricsPort), "Metrics port")
	flag.IntVar(&cfg.QueryPort, "query-port", getEnvInt("QUERY_PORT", defaultQueryPort), "Query API gRPC port")

	// Query API flags
	flag.BoolVar(&cfg.QueryEnabled, "query-enabled", getEnvBool("QUERY_ENABLED", true), "Enable query API server")
	flag.StringVar(&cfg.QueryAPIKey, "query-api-key", getEnv("QUERY_API_KEY", ""), "API key for query authentication (empty = no auth)")

	// Simulation flags
	flag.BoolVar(&cfg.SimulationEnabled, "simulation-enabled", getEnvBool("SIMULATION_ENABLED", true), "Enable simulation worker")
	flag.DurationVar(&cfg.SimulationPollInterval, "simulation-poll-interval", getEnvDuration("SIMULATION_POLL_INTERVAL", 30*time.Second), "Simulation poll interval")

	// Validation flags
	flag.BoolVar(&cfg.ValidationEnabled, "validation-enabled", getEnvBool("VALIDATION_ENABLED", true), "Enable validation agent")
	flag.DurationVar(&cfg.ValidationFlushInterval, "validation-flush-interval", getEnvDuration("VALIDATION_FLUSH_INTERVAL", time.Minute), "Validation data flush interval")
	flag.DurationVar(&cfg.ValidationPolicyRefresh, "validation-policy-refresh", getEnvDuration("VALIDATION_POLICY_REFRESH", 30*time.Second), "Policy refresh interval for validation")
	flag.IntVar(&cfg.ValidationEventBuffer, "validation-event-buffer", getEnvInt("VALIDATION_EVENT_BUFFER", 1000), "Validation event buffer size")
	flag.IntVar(&cfg.ValidationSampleRate, "validation-sample-rate", getEnvInt("VALIDATION_SAMPLE_RATE", 10), "Validation event sample rate (1 in N)")

	// Logging
	flag.StringVar(&cfg.LogLevel, "log-level", getEnv("LOG_LEVEL", "info"), "Log level (debug, info, warn, error)")

	flag.Parse()

	// Validate required fields
	if cfg.NodeName == "" {
		cfg.NodeName = os.Getenv("HOSTNAME")
	}

	return cfg
}

func initLogger(level string) (logr.Logger, error) {
	var zapLevel zapcore.Level
	switch level {
	case "debug":
		zapLevel = zapcore.DebugLevel
	case "info":
		zapLevel = zapcore.InfoLevel
	case "warn":
		zapLevel = zapcore.WarnLevel
	case "error":
		zapLevel = zapcore.ErrorLevel
	default:
		zapLevel = zapcore.InfoLevel
	}

	config := zap.NewProductionConfig()
	config.Level = zap.NewAtomicLevelAt(zapLevel)
	config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	zapLog, err := config.Build()
	if err != nil {
		return logr.Logger{}, err
	}

	return zapr.NewLogger(zapLog), nil
}

func runHubbleCollector(ctx context.Context, client *collector.HubbleClient, log logr.Logger) error {
	// Connect with retry
	connectCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if err := client.Connect(connectCtx); err != nil {
		return fmt.Errorf("failed to connect to Hubble: %w", err)
	}
	defer client.Close()

	log.Info("Connected to Hubble, starting flow collection")

	// Stream flows with automatic reconnection
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		err := client.StreamFlows(ctx)
		if ctx.Err() != nil {
			return nil // Context cancelled, clean shutdown
		}

		if err != nil {
			log.Error(err, "Flow stream error, reconnecting")
			if err := client.Reconnect(ctx); err != nil {
				return fmt.Errorf("reconnection failed: %w", err)
			}
		}
	}
}

func runTetragonCollector(ctx context.Context, client *collector.TetragonClient, log logr.Logger) error {
	// Connect with retry
	connectCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if err := client.Connect(connectCtx); err != nil {
		return fmt.Errorf("failed to connect to Tetragon: %w", err)
	}
	defer client.Close()

	log.Info("Connected to Tetragon, starting event collection")

	// Stream events with automatic reconnection
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		err := client.StreamEvents(ctx)
		if ctx.Err() != nil {
			return nil // Context cancelled, clean shutdown
		}

		if err != nil {
			log.Error(err, "Event stream error, reconnecting")
			if err := client.Reconnect(ctx); err != nil {
				return fmt.Errorf("reconnection failed: %w", err)
			}
		}
	}
}

func startHealthServer(port int, buffer *collector.RingBuffer, storageMgr *storage.Manager, log logr.Logger) {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		// Check if buffer is healthy (not full)
		if buffer.IsFull() {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("buffer full"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	addr := fmt.Sprintf(":%d", port)
	log.Info("Starting health server", "address", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error(err, "Health server failed")
	}
}

func startMetricsServer(port int, buffer *collector.RingBuffer, storageMgr *storage.Manager, saasSender *aggregator.SaaSSender, queryServer *query.Server, simWorker *simulation.Worker, validationAgent *validation.Agent, log logr.Logger) {
	mux := http.NewServeMux()

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		bufferMetrics := buffer.GetMetrics()
		w.Header().Set("Content-Type", "text/plain")

		// Buffer metrics
		fmt.Fprintf(w, "# HELP policyhub_collector_buffer_count Current events in buffer\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_buffer_count gauge\n")
		fmt.Fprintf(w, "policyhub_collector_buffer_count %d\n", bufferMetrics.CurrentCount)

		fmt.Fprintf(w, "# HELP policyhub_collector_buffer_capacity Buffer capacity\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_buffer_capacity gauge\n")
		fmt.Fprintf(w, "policyhub_collector_buffer_capacity %d\n", bufferMetrics.Capacity)

		fmt.Fprintf(w, "# HELP policyhub_collector_events_received_total Total events received\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_events_received_total counter\n")
		fmt.Fprintf(w, "policyhub_collector_events_received_total %d\n", bufferMetrics.TotalReceived)

		fmt.Fprintf(w, "# HELP policyhub_collector_events_flushed_total Total events flushed\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_events_flushed_total counter\n")
		fmt.Fprintf(w, "policyhub_collector_events_flushed_total %d\n", bufferMetrics.TotalFlushed)

		fmt.Fprintf(w, "# HELP policyhub_collector_events_dropped_total Total events dropped\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_events_dropped_total counter\n")
		fmt.Fprintf(w, "policyhub_collector_events_dropped_total %d\n", bufferMetrics.TotalDropped)

		fmt.Fprintf(w, "# HELP policyhub_collector_buffer_fill_percentage Buffer fill percentage\n")
		fmt.Fprintf(w, "# TYPE policyhub_collector_buffer_fill_percentage gauge\n")
		fmt.Fprintf(w, "policyhub_collector_buffer_fill_percentage %.2f\n", bufferMetrics.FillPercentage)

		// Storage metrics
		storageStats, err := storageMgr.GetStats(r.Context())
		if err == nil && storageStats != nil {
			if storageStats.IndexStats != nil {
				fmt.Fprintf(w, "# HELP policyhub_collector_storage_events_total Total events in storage\n")
				fmt.Fprintf(w, "# TYPE policyhub_collector_storage_events_total gauge\n")
				fmt.Fprintf(w, "policyhub_collector_storage_events_total %d\n", storageStats.IndexStats.TotalEvents)

				fmt.Fprintf(w, "# HELP policyhub_collector_storage_files_total Total Parquet files\n")
				fmt.Fprintf(w, "# TYPE policyhub_collector_storage_files_total gauge\n")
				fmt.Fprintf(w, "policyhub_collector_storage_files_total %d\n", storageStats.IndexStats.TotalFiles)

				fmt.Fprintf(w, "# HELP policyhub_collector_storage_bytes Total storage bytes\n")
				fmt.Fprintf(w, "# TYPE policyhub_collector_storage_bytes gauge\n")
				fmt.Fprintf(w, "policyhub_collector_storage_bytes %d\n", storageStats.IndexStats.TotalSizeBytes)
			}

			if storageStats.RetentionStats != nil {
				fmt.Fprintf(w, "# HELP policyhub_collector_storage_usage_percent Storage usage percentage\n")
				fmt.Fprintf(w, "# TYPE policyhub_collector_storage_usage_percent gauge\n")
				fmt.Fprintf(w, "policyhub_collector_storage_usage_percent %.2f\n", storageStats.RetentionStats.StorageUsagePercent)

				fmt.Fprintf(w, "# HELP policyhub_collector_storage_days_stored Days of data stored\n")
				fmt.Fprintf(w, "# TYPE policyhub_collector_storage_days_stored gauge\n")
				fmt.Fprintf(w, "policyhub_collector_storage_days_stored %d\n", storageStats.RetentionStats.DaysStored)
			}
		}

		// SaaS sender metrics
		if saasSender != nil && saasSender.IsEnabled() {
			saasStats := saasSender.GetStats()
			fmt.Fprintf(w, "# HELP policyhub_collector_saas_sent_total Total aggregates sent to SaaS\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_saas_sent_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_saas_sent_total %d\n", saasStats.TotalSent)

			fmt.Fprintf(w, "# HELP policyhub_collector_saas_failed_total Total aggregates failed to send\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_saas_failed_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_saas_failed_total %d\n", saasStats.TotalFailed)

			fmt.Fprintf(w, "# HELP policyhub_collector_saas_pending_flows Pending flow aggregations\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_saas_pending_flows gauge\n")
			fmt.Fprintf(w, "policyhub_collector_saas_pending_flows %d\n", saasStats.PendingFlows)

			fmt.Fprintf(w, "# HELP policyhub_collector_saas_pending_process Pending process aggregations\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_saas_pending_process gauge\n")
			fmt.Fprintf(w, "policyhub_collector_saas_pending_process %d\n", saasStats.PendingProcessEvents)

			fmt.Fprintf(w, "# HELP policyhub_collector_saas_last_send_success Last send success (1=success, 0=failure)\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_saas_last_send_success gauge\n")
			if saasStats.LastSendSuccess {
				fmt.Fprintf(w, "policyhub_collector_saas_last_send_success 1\n")
			} else {
				fmt.Fprintf(w, "policyhub_collector_saas_last_send_success 0\n")
			}
		}

		// Query server metrics
		if queryServer != nil {
			queryStats := queryServer.GetStats()
			fmt.Fprintf(w, "# HELP policyhub_collector_query_total Total queries received\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_query_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_query_total %d\n", queryStats.TotalQueries)

			fmt.Fprintf(w, "# HELP policyhub_collector_query_events_total Total events returned by queries\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_query_events_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_query_events_total %d\n", queryStats.TotalEvents)

			fmt.Fprintf(w, "# HELP policyhub_collector_query_errors_total Total query errors\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_query_errors_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_query_errors_total %d\n", queryStats.QueryErrors)

			fmt.Fprintf(w, "# HELP policyhub_collector_query_server_started Query server running (1=yes, 0=no)\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_query_server_started gauge\n")
			if queryStats.Started {
				fmt.Fprintf(w, "policyhub_collector_query_server_started 1\n")
			} else {
				fmt.Fprintf(w, "policyhub_collector_query_server_started 0\n")
			}
		}

		// Simulation worker metrics
		if simWorker != nil {
			simStats := simWorker.GetStats()
			fmt.Fprintf(w, "# HELP policyhub_collector_simulation_processed_total Total simulations processed\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_simulation_processed_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_simulation_processed_total %d\n", simStats.TotalProcessed)

			fmt.Fprintf(w, "# HELP policyhub_collector_simulation_errors_total Total simulation errors\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_simulation_errors_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_simulation_errors_total %d\n", simStats.TotalErrors)

			fmt.Fprintf(w, "# HELP policyhub_collector_simulation_worker_running Simulation worker running (1=yes, 0=no)\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_simulation_worker_running gauge\n")
			if simStats.Running {
				fmt.Fprintf(w, "policyhub_collector_simulation_worker_running 1\n")
			} else {
				fmt.Fprintf(w, "policyhub_collector_simulation_worker_running 0\n")
			}
		}

		// Validation agent metrics
		if validationAgent != nil {
			valStats := validationAgent.GetStats()
			fmt.Fprintf(w, "# HELP policyhub_collector_validation_processed_total Total flows validated\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_processed_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_processed_total %d\n", valStats.TotalProcessed)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_allowed_total Total flows allowed by policy\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_allowed_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_allowed_total %d\n", valStats.TotalAllowed)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_blocked_total Total flows blocked by policy\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_blocked_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_blocked_total %d\n", valStats.TotalBlocked)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_no_policy_total Total flows without policy coverage\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_no_policy_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_no_policy_total %d\n", valStats.TotalNoPolicy)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_reports_sent_total Total validation reports sent to SaaS\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_reports_sent_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_reports_sent_total %d\n", valStats.ReportsSent)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_reports_failed_total Total validation reports failed\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_reports_failed_total counter\n")
			fmt.Fprintf(w, "policyhub_collector_validation_reports_failed_total %d\n", valStats.ReportsFailed)

			fmt.Fprintf(w, "# HELP policyhub_collector_validation_running Validation agent running (1=yes, 0=no)\n")
			fmt.Fprintf(w, "# TYPE policyhub_collector_validation_running gauge\n")
			if valStats.Running {
				fmt.Fprintf(w, "policyhub_collector_validation_running 1\n")
			} else {
				fmt.Fprintf(w, "policyhub_collector_validation_running 0\n")
			}
		}
	})

	addr := fmt.Sprintf(":%d", port)
	log.Info("Starting metrics server", "address", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error(err, "Metrics server failed")
	}
}

// Helper functions for environment variable parsing

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true" || value == "1" || value == "yes"
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var i int
		if _, err := fmt.Sscanf(value, "%d", &i); err == nil {
			return i
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			return d
		}
	}
	return defaultValue
}
