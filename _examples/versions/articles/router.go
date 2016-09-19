package articles

import (
	"net/http"

	"github.com/pressly/chi"
)

func Router() http.Handler {
	r := chi.NewRouter()
	r.Get("/", listArticles)
	r.Route("/:articleID", func(r chi.Router) {
		r.Get("/", getArticle)
		// r.Put("/", updateArticle)
		// r.Delete("/", deleteArticle)
	})
	return r
}
