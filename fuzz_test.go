//go:build go1.18
// +build go1.18

// Copyright (c) 2015-present Peter Kieltyka
// SPDX-License-Identifier: MIT

package chi_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// FuzzChiRouteMatch tests HTTP route matching with arbitrary
// paths and HTTP methods. Chi is a popular Go HTTP router
// (22K+ stars) used in production APIs.
func FuzzChiRouteMatch(f *testing.F) {
	f.Add("/api/users", "GET")
	f.Add("/api/users/:id", "GET")
	f.Add("/", "POST")
	f.Add(strings.Repeat("/a", 50), "GET")
	f.Add("", "")

	f.Fuzz(func(t *testing.T, path, method string) {
		if len(path) > 10000 || len(method) > 20 {
			return
		}

		func() {
			defer func() { _ = recover() }()

			r := chi.NewRouter()
			r.Get("/test", func(w http.ResponseWriter, r *http.Request) {})
			r.Get("/api/{resource}", func(w http.ResponseWriter, r *http.Request) {})

			req := httptest.NewRequest(method, path, nil)
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
		}()
	})
}

// FuzzChiURLParam tests URL parameter extraction with arbitrary
// path patterns and request paths.
func FuzzChiURLParam(f *testing.F) {
	f.Add("/users/123", "userID")
	f.Add("/api/v1/users/42/posts/7", "postID")
	f.Add("", "")

	f.Fuzz(func(t *testing.T, path, paramName string) {
		if len(path) > 10000 || len(paramName) > 1000 {
			return
		}

		rctx := chi.NewRouteContext()
		_ = rctx.URLParam(paramName)

		func() {
			defer func() { _ = recover() }()
			r := chi.NewRouter()
			r.Get("/{param}", func(w http.ResponseWriter, r *http.Request) {
				_ = chi.URLParam(r, "param")
			})
			req := httptest.NewRequest("GET", path, nil)
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
		}()
	})
}
