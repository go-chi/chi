package main

import (
	"fmt"
	"net/http"
	
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	
	// Standard middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	
	// Routes
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Welcome"))
	})
	
	// User routes
	r.Route("/users", func(r chi.Router) {
		r.Get("/", listUsers)
		r.Post("/", createUser)
		
		r.Route("/{userID}", func(r chi.Router) {
			r.Get("/", getUser)
			r.Put("/", updateUser)
			r.Delete("/", deleteUser)
		})
	})
	
	// Article routes
	r.Route("/articles", func(r chi.Router) {
		r.Get("/", listArticles)
		r.Get("/{articleID}", getArticle)
		r.Post("/", createArticle)
	})
	
	// Admin routes
	adminRouter := chi.NewRouter()
	adminRouter.Get("/", adminDashboard)
	adminRouter.Get("/users", adminListUsers)
	r.Mount("/admin", adminRouter)
	
	// Print all registered routes
	fmt.Println("Registered routes:")
	fmt.Println("==================")
	r.PrintRoutes()
	fmt.Println("==================")
	
	// Start server
	fmt.Println("\nServer starting on :3000")
	http.ListenAndServe(":3000", r)
}

func listUsers(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("List users"))
}

func createUser(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Create user"))
}

func getUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	w.Write([]byte(fmt.Sprintf("Get user %s", userID)))
}

func updateUser(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Update user"))
}

func deleteUser(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Delete user"))
}

func listArticles(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("List articles"))
}

func getArticle(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Get article"))
}

func createArticle(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Create article"))
}

func adminDashboard(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Admin dashboard"))
}

func adminListUsers(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Admin list users"))
}
