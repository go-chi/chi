package chi

import "testing"

// TestRoutePattern tests correct in-the-middle wildcard removals.
// If user organizes a router like this:
//
// (router.go)
//
//	r.Route("/v1", func(r chi.Router) {
//		r.Mount("/resources", resourcesController{}.Router())
//	}
//
// (resources_controller.go)
//
//	r.Route("/", func(r chi.Router) {
//		r.Get("/{resource_id}", getResource())
//		// other routes...
//	}
//
// This test checks how the route pattern is calculated
// "/v1/resources/{resource_id}" (right)
// "/v1/resources/*/{resource_id}" (wrong)
func TestRoutePattern(t *testing.T) {
	routePatterns := []string{
		"/v1/*",
		"/resources/*",
		"/{resource_id}",
	}

	x := &Context{
		RoutePatterns: routePatterns,
	}

	if p := x.RoutePattern(); p != "/v1/resources/{resource_id}" {
		t.Fatal("unexpected route pattern: " + p)
	}

	x.RoutePatterns = []string{
		"/v1/*",
		"/resources/*",
		// Additional wildcard, depending on the router structure of the user
		"/*",
		"/{resource_id}",
	}

	// Correctly removes in-the-middle wildcards instead of "/v1/resources/*/{resource_id}"
	if p := x.RoutePattern(); p != "/v1/resources/{resource_id}" {
		t.Fatal("unexpected route pattern: " + p)
	}

	x.RoutePatterns = []string{
		"/v1/*",
		"/resources/*",
		// Even with many wildcards
		"/*",
		"/*",
		"/*",
		"/{resource_id}/*", // Keeping trailing wildcard
	}

	// Correctly removes in-the-middle wildcards instead of "/v1/resources/*/*/{resource_id}/*"
	if p := x.RoutePattern(); p != "/v1/resources/{resource_id}/*" {
		t.Fatal("unexpected route pattern: " + p)
	}

	x.RoutePatterns = []string{
		"/v1/*",
		"/resources/*",
		// And respects asterisks as part of the paths
		"/*special_path/*",
		"/with_asterisks*/*",
		"/{resource_id}",
	}

	// Correctly removes in-the-middle wildcards instead of "/v1/resourcesspecial_path/with_asterisks{resource_id}"
	if p := x.RoutePattern(); p != "/v1/resources/*special_path/with_asterisks*/{resource_id}" {
		t.Fatal("unexpected route pattern: " + p)
	}

	// Testing for the root route pattern
	x.RoutePatterns = []string{"/"}
	// It should just return "/" as the pattern
	if p := x.RoutePattern(); p != "/" {
		t.Fatal("unexpected route pattern for root: " + p)
	}
}

func TestRouteParams(t *testing.T) {
	rp := &RouteParams{}
	rp.Add("id", "1")
	rp.Add("name", "n")
	rp.Add("id", "2")

	if got, want := rp.Get("id"), "2"; got != want {
		t.Fatalf("unexpected route param value for key 'id': %s, want: %s", got, want)
	}
	if got, want := rp.Get("name"), "n"; got != want {
		t.Fatalf("unexpected route param value for key 'name': %s, want: %s", got, want)
	}
}
