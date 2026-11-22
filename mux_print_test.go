package chi

import (
	"bytes"
	"net/http"
	"strings"
	"testing"
)

func TestMux_PrintRoutes(t *testing.T) {
	r := NewRouter()

	// Register various routes
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
	r.Post("/users", func(w http.ResponseWriter, r *http.Request) {})
	r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {})
	r.Put("/users/{id}", func(w http.ResponseWriter, r *http.Request) {})
	r.Delete("/users/{id}", func(w http.ResponseWriter, r *http.Request) {})

	// Use a subrouter
	r.Route("/articles", func(r Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
		r.Get("/{slug}", func(w http.ResponseWriter, r *http.Request) {})
	})

	// Capture output
	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := buf.String()

	// Check that all routes are printed
	// Note: The format is "[METHOD  ] /path" with padding inside brackets
	expectedRoutes := map[string]bool{
		"GET":         false,
		"POST":        false,
		"PUT":         false,
		"DELETE":      false,
		"/":           false,
		"/users":      false,
		"/users/{id}": false,
		"/articles/":  false,
		"/{slug}":     false,
	}

	for expected := range expectedRoutes {
		if strings.Contains(output, expected) {
			expectedRoutes[expected] = true
		}
	}

	// Verify all expected components were found
	for expected, found := range expectedRoutes {
		if !found {
			t.Errorf("Expected route component not found in output: %s\nFull output:\n%s", expected, output)
		}
	}

	// Check for proper formatting
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) < 7 {
		t.Errorf("Expected at least 7 routes, got %d\nOutput:\n%s", len(lines), output)
	}
}

func TestMux_PrintRoutesEmpty(t *testing.T) {
	r := NewRouter()

	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := buf.String()

	// Empty router should produce minimal or no output
	if len(output) > 0 {
		t.Logf("Empty router output: %s", output)
	}
}

func TestMux_PrintRoutesWithMiddleware(t *testing.T) {
	r := NewRouter()

	// Add middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/test", func(w http.ResponseWriter, r *http.Request) {})

	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := buf.String()

	// Just check that the route is there, don't worry about exact format
	if !strings.Contains(output, "GET") || !strings.Contains(output, "/test") {
		t.Errorf("Route with middleware not printed correctly: %s", output)
	}
}

func TestMux_PrintRoutesWithMount(t *testing.T) {
	r := NewRouter()

	// Create a sub-router
	apiRouter := NewRouter()
	apiRouter.Get("/health", func(w http.ResponseWriter, r *http.Request) {})
	apiRouter.Get("/status", func(w http.ResponseWriter, r *http.Request) {})

	// Mount it
	r.Mount("/api", apiRouter)

	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := buf.String()

	// Check for mounted routes
	if !strings.Contains(output, "/api") {
		t.Errorf("Mounted routes not found in output: %s", output)
	}
}

func TestMux_PrintRoutesMultipleMethods(t *testing.T) {
	r := NewRouter()

	// Same path, different methods
	r.Get("/resource", func(w http.ResponseWriter, r *http.Request) {})
	r.Post("/resource", func(w http.ResponseWriter, r *http.Request) {})
	r.Put("/resource", func(w http.ResponseWriter, r *http.Request) {})
	r.Delete("/resource", func(w http.ResponseWriter, r *http.Request) {})

	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := buf.String()

	// All methods should be printed
	methods := []string{"GET", "POST", "PUT", "DELETE"}
	for _, method := range methods {
		if !strings.Contains(output, method) {
			t.Errorf("Method %s not found in output: %s", method, output)
		}
	}

	// Check that /resource appears
	if !strings.Contains(output, "/resource") {
		t.Errorf("/resource path not found in output: %s", output)
	}
}

func TestMux_PrintRoutesFormat(t *testing.T) {
	r := NewRouter()
	r.Get("/test", func(w http.ResponseWriter, r *http.Request) {})

	var buf bytes.Buffer
	r.PrintRoutesWithWriter(&buf)

	output := strings.TrimSpace(buf.String())

	// Check format: should be "[METHOD  ] /path"
	// The %-7s format creates padding inside the brackets
	if !strings.HasPrefix(output, "[") {
		t.Errorf("Expected output to start with '[', got: %s", output)
	}

	if !strings.Contains(output, "] ") {
		t.Errorf("Expected output to contain '] ', got: %s", output)
	}
}

func TestMux_PrintRoutesFunc(t *testing.T) {
	r := NewRouter()

	// Register routes
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
	r.Post("/users", func(w http.ResponseWriter, r *http.Request) {})
	r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {})

	// Capture output using custom logging function
	var lines []string
	r.PrintRoutesFunc(func(s string) {
		lines = append(lines, s)
	})

	// Verify we got routes
	if len(lines) < 3 {
		t.Errorf("Expected at least 3 lines, got %d", len(lines))
	}

	// Join all lines for easy checking
	output := strings.Join(lines, "\n")

	// Check that routes are present
	expectedComponents := []string{"GET", "POST", "/", "/users", "/{id}"}
	for _, expected := range expectedComponents {
		if !strings.Contains(output, expected) {
			t.Errorf("Expected component not found: %s\nOutput:\n%s", expected, output)
		}
	}
}

func TestMux_PrintRoutesFunc_Integration(t *testing.T) {
	r := NewRouter()

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {})
	r.Post("/api/users", func(w http.ResponseWriter, r *http.Request) {})

	// Simulate integration with a logging library
	var loggedMessages []string
	customLogger := func(msg string) {
		// Simulate logger.Info() behavior
		loggedMessages = append(loggedMessages, "[INFO] "+msg)
	}

	r.PrintRoutesFunc(customLogger)

	if len(loggedMessages) < 2 {
		t.Errorf("Expected at least 2 logged messages, got %d", len(loggedMessages))
	}

	// Verify format includes [INFO] prefix
	for _, msg := range loggedMessages {
		if !strings.HasPrefix(msg, "[INFO]") {
			t.Errorf("Expected message to have [INFO] prefix, got: %s", msg)
		}
	}
}
