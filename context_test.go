package chi

import "testing"

// TestRoutePattern tests correct wildcard removals.
// If user organizes a router like this:
//
// (router.go)
// r.Route("/v1", func(r chi.Router) {
// 	r.Mount("/resources", resourcesController{}.Router())
// }
//
// (resources_controller.go)
// r.Route("/", func(r chi.Router) {
// 	r.Get("/{resource_id}", getResource())
// }
//
// The route pattern could be "/v1/resources/*/resource_id" instead of "/v1/resources/resource_id"
// This test makes sure wildcards are removed correctly.
func TestRoutePattern(t *testing.T) {
	routePatterns := []string{
		"/v1",
		"/resources/*",
		"/resource_id",
	}

	x := &Context{
		RoutePatterns: routePatterns,
	}

	if p := x.RoutePattern(); p != "/v1/resources/resource_id" {
		t.Fatal("unexpected route path: " + p)
	}

	x.RoutePatterns = []string{
		"/v1",
		"/resources/*",
		// Additional wildcard, depending on the router structure of the user
		"/*",
		"/resource_id",
	}

	// Correctly removes wildcards instead of "/v1/resources/*/resource_id"
	if p := x.RoutePattern(); p != "/v1/resources/resource_id" {
		t.Fatal("unexpected route path: " + p)
	}

	x.RoutePatterns = []string{
		"/v1",
		"/resources/*",
		// Even with many wildcards
		"/*",
		"/*",
		"/*",
		"/resource_id/*", // And trailing wildcard
	}

	// Correctly removes wildcards instead of "/v1/resources/*/*/resource_id/*"
	if p := x.RoutePattern(); p != "/v1/resources/resource_id" {
		t.Fatal("unexpected route path: " + p)
	}
}
