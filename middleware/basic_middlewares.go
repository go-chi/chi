package middleware

import (
	"github.com/go-chi/chi/v5"
)

// BasicMiddlewares offers a good base middleware stack,
// includes middleware.Logger, middleware.Recoverer, middleware.RequestID and middleware.RealIP
func BasicMiddlewares(r *chi.Mux) {

	r.Use(Logger)
	r.Use(Recoverer)
	r.Use(RequestID)
	r.Use(RealIP)

}
