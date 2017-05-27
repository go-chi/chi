# Makefile for Chi (https://github.com/pressly/chi)
#
# Targets:
#	all (default): Builds and tests the code
#	build: Builds the code
#	test: Runs the tests
#	fmt: Formats the source files

# Build settings
GOCMD?=go
# Allow setting of Go flags via the command line
GOFLAGS?=$(GOFLAGS:)

.PHONY: all test fmt

all: build test

build:
	$(GOCMD) build $(GOFLAGS) ./...

test: build
	$(GOCMD) test $(GOFLAGS) ./...

fmt:
	gofmt -w .

