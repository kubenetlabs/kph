# Image URLs for building/pushing image targets
# The main image contains both operator manager AND collector binaries
# This allows using a single image for both deployments with different entrypoints
OPERATOR_IMG ?= ghcr.io/henleda/policy-hub-operator:latest
COLLECTOR_IMG ?= ghcr.io/henleda/policy-hub-collector:latest
# Legacy alias for backwards compatibility
IMG ?= $(OPERATOR_IMG)

# Get the currently used golang install path
GOBIN ?= $(shell go env GOBIN)
ifeq (,$(GOBIN))
GOBIN := $(shell go env GOPATH)/bin
endif

# Setting SHELL to bash allows bash commands to be executed by recipes
SHELL = /usr/bin/env bash -o pipefail
.SHELLFLAGS = -ec

.PHONY: all
all: build

##@ General

.PHONY: help
help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

.PHONY: fmt
fmt: ## Run go fmt against code
	go fmt ./...

.PHONY: vet
vet: ## Run go vet against code
	go vet ./...

.PHONY: test
test: fmt vet ## Run tests
	go test ./... -coverprofile cover.out

.PHONY: lint
lint: ## Run golangci-lint
	golangci-lint run

##@ Build

.PHONY: build
build: fmt vet ## Build manager binary
	go build -o bin/manager cmd/main.go

.PHONY: run
run: fmt vet ## Run against the configured Kubernetes cluster
	go run cmd/main.go

.PHONY: docker-build
docker-build: ## Build docker image
	docker build -t ${IMG} .

.PHONY: docker-push
docker-push: ## Push docker image
	docker push ${IMG}

.PHONY: docker-buildx
docker-buildx: ## Build and push combined image (operator+collector) for cross-platform support
	docker buildx build --platform linux/amd64,linux/arm64 -t ${OPERATOR_IMG} --push .

.PHONY: docker-buildx-collector
docker-buildx-collector: ## Build and push collector-only image for cross-platform support
	docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.collector -t ${COLLECTOR_IMG} --push .

.PHONY: docker-buildx-all
docker-buildx-all: docker-buildx docker-buildx-collector ## Build and push all images for cross-platform support

.PHONY: docker-build-collector
docker-build-collector: ## Build collector-only docker image (native platform)
	docker build -f Dockerfile.collector -t ${COLLECTOR_IMG} .

##@ Deployment

.PHONY: install
install: ## Install CRDs into the K8s cluster
	kubectl apply -f config/crd/bases/

.PHONY: uninstall
uninstall: ## Uninstall CRDs from the K8s cluster
	kubectl delete -f config/crd/bases/

.PHONY: deploy
deploy: ## Deploy controller to the K8s cluster
	kubectl apply -f config/crd/bases/
	kubectl apply -f config/rbac/role.yaml
	kubectl apply -f config/manager/manager.yaml

.PHONY: undeploy
undeploy: ## Undeploy controller from the K8s cluster
	kubectl delete -f config/manager/manager.yaml
	kubectl delete -f config/rbac/role.yaml
	kubectl delete -f config/crd/bases/

##@ Dependencies

.PHONY: tidy
tidy: ## Run go mod tidy
	go mod tidy

.PHONY: vendor
vendor: ## Run go mod vendor
	go mod vendor

.PHONY: verify
verify: tidy ## Verify go.mod is up to date
	git diff --exit-code go.mod go.sum
