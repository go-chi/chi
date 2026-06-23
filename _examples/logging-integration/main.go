package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Register some routes
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Home"))
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("OK"))
		})
		r.Post("/users", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("Create user"))
		})
		r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("Get user"))
		})
	})

	fmt.Println("\n=== Example 1: Using PrintRoutes (simple) ===")
	r.PrintRoutes()

	fmt.Println("\n=== Example 2: Using PrintRoutesFunc with standard log ===")
	r.PrintRoutesFunc(func(s string) {
		log.Println(s)
	})

	fmt.Println("\n=== Example 3: Using PrintRoutesFunc with custom logger ===")
	// Simulate a custom logger (like logrus, zap, slog, etc.)
	customLogger := &CustomLogger{prefix: "[ROUTES]"}
	r.PrintRoutesFunc(customLogger.Info)

	fmt.Println("\n=== Example 4: Using PrintRoutesFunc with filtering ===")
	// Only log GET routes
	r.PrintRoutesFunc(func(s string) {
		if contains(s, "GET") {
			fmt.Printf("GET route: %s\n", s)
		}
	})

	fmt.Println("\nServer starting on :3000")
	http.ListenAndServe(":3000", r)
}

// CustomLogger simulates a structured logging library
type CustomLogger struct {
	prefix string
}

func (l *CustomLogger) Info(msg string) {
	fmt.Printf("%s [INFO] %s\n", l.prefix, msg)
}

func (l *CustomLogger) Debug(msg string) {
	fmt.Printf("%s [DEBUG] %s\n", l.prefix, msg)
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && s[:len(substr)] == substr ||
		len(s) > len(substr) && findSubstring(s, substr)
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
