package chi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"
)

func TestMatchMountedBaseWithoutHandler(t *testing.T) {
	r := NewRouter()
	r.Route("/path", func(r Router) {
		r.Get("/all", func(http.ResponseWriter, *http.Request) {})
	})
	for _, path := range []string{"/path", "/path/"} {
		t.Run(path, func(t *testing.T) {
			if r.Match(NewRouteContext(), http.MethodGet, path) {
				t.Errorf("Match(GET, %q) = true, want false without a base handler", path)
			}
		})
	}
	if !r.Match(NewRouteContext(), http.MethodGet, "/path/all") {
		t.Fatal("registered child route did not match")
	}
}

func TestMuxMatchMountedBase(t *testing.T) {
	for _, wrap := range []bool{false, true} {
		for _, baseHandler := range []bool{false, true} {
			for _, trailingSlash := range []bool{false, true} {
				name := fmt.Sprintf("wrapped=%v/base=%v/trailing=%v", wrap, baseHandler, trailingSlash)
				t.Run(name, func(t *testing.T) {
					child := NewRouter()
					ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
					child.Get("/all", ok)
					if baseHandler {
						child.Get("/", ok)
					}
					var handler http.Handler = child
					if wrap {
						handler = mountedRouter{child}
					}
					r := NewRouter()
					pattern := "/path"
					if trailingSlash {
						pattern += "/"
					}
					r.Mount(pattern, handler)
					for _, method := range []string{http.MethodGet, http.MethodPost} {
						for _, path := range []string{"/path", "/path/", "/path/all", "/path/missing"} {
							want := ""
							if method == http.MethodGet {
								if path == "/path/all" {
									want = "/path/all"
								} else if baseHandler && (path == "/path/" || path == "/path" && !trailingSlash) {
									want = "/path/"
								}
							}
							assertMountedMatch(t, r, method, path, want)
						}
					}
				})
			}
		}
	}
}

// Exercise a Routes implementation that is not itself a *Mux.
type mountedRouter struct{ Router }

func assertMountedMatch(t *testing.T, r Router, method, path, wantPattern string) {
	t.Helper()
	ctx := NewRouteContext()
	if got := r.Find(ctx, method, path); got != wantPattern {
		t.Errorf("Find(%s, %q) = %q, want %q", method, path, got, wantPattern)
	}
	if got := r.Match(NewRouteContext(), method, path); got != (wantPattern != "") {
		t.Errorf("Match(%s, %q) = %v, want %v", method, path, got, wantPattern != "")
	}
	recorder := httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	if served := recorder.Code == http.StatusOK; served != (wantPattern != "") {
		t.Errorf("ServeHTTP(%s, %q) returned %d, inconsistent with pattern %q", method, path, recorder.Code, wantPattern)
	}
}

func TestMuxMatchEmptyMountedRouter(t *testing.T) {
	r := NewRouter()
	r.Route("/path", func(Router) {})
	for _, path := range []string{"/path", "/path/", "/path/all"} {
		assertMountedMatch(t, r, http.MethodGet, path, "")
	}
}

func TestMuxMatchNestedMountedBase(t *testing.T) {
	r := NewRouter()
	r.Route("/tenants/{tenant}", func(r Router) {
		r.Route("/users/{user}", func(r Router) {
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				if URLParam(r, "tenant") != "acme" || URLParam(r, "user") != "42" {
					t.Errorf("request lost mounted route parameters: %v", RouteContext(r.Context()).URLParams)
				}
				w.WriteHeader(http.StatusOK)
			})
		})
	})
	for _, path := range []string{"/tenants/acme", "/tenants/acme/"} {
		assertMountedMatch(t, r, http.MethodGet, path, "")
	}
	for _, path := range []string{"/tenants/acme/users/42", "/tenants/acme/users/42/"} {
		const pattern = "/tenants/{tenant}/users/{user}/"
		assertMountedMatch(t, r, http.MethodGet, path, pattern)
		assertMountedMatch(t, r, http.MethodPost, path, "")
		ctx := NewRouteContext()
		r.Find(ctx, http.MethodGet, path)
		if ctx.URLParam("tenant") != "acme" || ctx.URLParam("user") != "42" {
			t.Errorf("Find lost mounted route parameters: %v", ctx.URLParams)
		}
		// RoutePattern intentionally normalizes a trailing slash, unlike Find.
		const contextPattern = "/tenants/{tenant}/users/{user}"
		if got := ctx.RoutePattern(); got != contextPattern {
			t.Errorf("RoutePattern() = %q, want %q", got, contextPattern)
		}
	}
}

func TestMuxMatchPlainMountedHandler(t *testing.T) {
	r := NewRouter()
	r.Mount("/plain", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for path, pattern := range map[string]string{
		"/plain": "/plain", "/plain/": "/plain/", "/plain/anything": "/plain/*",
	} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			assertMountedMatch(t, r, method, path, pattern)
		}
	}
}

func TestMuxMatchOverriddenMountEndpoint(t *testing.T) {
	for _, allMethods := range []bool{false, true} {
		for pattern, path := range map[string]string{
			"/path": "/path", "/path/": "/path/", "/path/*": "/path/all",
		} {
			t.Run(fmt.Sprintf("all=%v/%s", allMethods, pattern), func(t *testing.T) {
				r := NewRouter()
				r.Route("/path", func(r Router) {
					r.Get("/all", func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusOK)
					})
				})
				h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
				if allMethods {
					r.Handle(pattern, h)
				} else {
					r.Get(pattern, h)
				}
				assertMountedMatch(t, r, http.MethodGet, path, pattern)
				postPattern := ""
				if allMethods {
					postPattern = pattern
				}
				assertMountedMatch(t, r, http.MethodPost, path, postPattern)
			})
		}
	}
}

func TestMuxMountedBasePreservesWalkAndMiddleware(t *testing.T) {
	calls := 0
	middleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			next.ServeHTTP(w, r)
		})
	}
	r := NewRouter()
	r.With(middleware).Route("/path", func(r Router) {
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/all", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	})
	for _, path := range []string{"/path", "/path/"} {
		if !r.Match(NewRouteContext(), http.MethodGet, path) {
			t.Errorf("inline mounted base %q did not match", path)
		}
		if r.Match(NewRouteContext(), http.MethodPost, path) {
			t.Errorf("inline mounted base %q matched an unregistered method", path)
		}
	}
	if calls != 0 {
		t.Fatal("Match executed middleware")
	}
	assertMountedMatch(t, r, http.MethodGet, "/path", "/path/")
	if calls != 1 {
		t.Errorf("request executed middleware %d times, want 1", calls)
	}
	var routes []string
	err := Walk(r, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		routes = append(routes, method+" "+route)
		if len(middlewares) != 1 {
			t.Errorf("route %s has %d middleware, want 1", route, len(middlewares))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(routes)
	if !reflect.DeepEqual(routes, []string{"GET /path/", "GET /path/all"}) {
		t.Errorf("Walk exposed mount stubs or duplicated routes: %v", routes)
	}
}
