# Build stage - run on target platform for CGO compatibility
FROM --platform=$TARGETPLATFORM golang:1.22-alpine AS builder

WORKDIR /workspace

# Install build dependencies including CGO requirements for SQLite
RUN apk add --no-cache git ca-certificates gcc musl-dev

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY cmd/ cmd/
COPY api/ api/
COPY internal/ internal/

# Build operator manager (no CGO needed)
RUN CGO_ENABLED=0 go build -a -o manager cmd/main.go

# Build collector with CGO for SQLite support
RUN CGO_ENABLED=1 go build -a -o collector cmd/collector/main.go

# Runtime stage - use alpine for musl-libc compatibility
FROM --platform=$TARGETPLATFORM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /

COPY --from=builder /workspace/manager .
COPY --from=builder /workspace/collector .

USER 65532:65532

ENTRYPOINT ["/manager"]
