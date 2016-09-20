//
// REST
// ====
// This example demonstrates a HTTP REST web service with some fixture data.
// Follow along the example and patterns.
//
// Also check routes.json for the generated docs from passing the -routes flag
//
// Boot the server:
// ----------------
// $ go run main.go
//
// Client requests:
// ----------------
// $ curl http://localhost:3333/
// root.
//
// $ curl http://localhost:3333/articles
// [{"id":"1","title":"Hi"},{"id":"2","title":"sup"}]
//
// $ curl http://localhost:3333/articles/1
// {"id":"1","title":"Hi"}
//
// $ curl -X DELETE http://localhost:3333/articles/1
// {"id":"1","title":"Hi"}
//
// $ curl http://localhost:3333/articles/1
// "Not Found"
//
// $ curl -X POST -d '{"id":"will-be-omitted","title":"awesomeness"}' http://localhost:3333/articles
// {"id":"97","title":"awesomeness"}
//
// $ curl http://localhost:3333/articles/97
// {"id":"97","title":"awesomeness"}
//
// $ curl http://localhost:3333/articles
// [{"id":"2","title":"sup"},{"id":"97","title":"awesomeness"}]
//
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"math/rand"
	"net/http"

	"github.com/pressly/chi"
	"github.com/pressly/chi/docgen"
	"github.com/pressly/chi/middleware"
	"github.com/pressly/chi/render"
)

var routes = flag.Bool("routes", false, "Generate router documentation")

func main() {
	flag.Parse()

	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root."))
	})

	r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("pong"))
	})

	r.Get("/panic", func(w http.ResponseWriter, r *http.Request) {
		panic("test")
	})

	// RESTy routes for "articles" resource
	r.Route("/articles", func(r chi.Router) {
		r.With(paginate).Get("/", ListArticles)
		r.Post("/", CreateArticle)       // POST /articles
		r.Get("/search", SearchArticles) // GET /articles/search

		r.Route("/:articleID", func(r chi.Router) {
			r.Use(ArticleCtx)            // Load the *Article on the request context
			r.Get("/", GetArticle)       // GET /articles/123
			r.Put("/", UpdateArticle)    // PUT /articles/123
			r.Delete("/", DeleteArticle) // DELETE /articles/123
		})
	})

	// Mount the admin sub-router, the same as a call to
	// Route("/admin", func(r chi.Router) { with routes here })
	r.Mount("/admin", adminRouter())

	// Passing -routes to the program will generate docs for the above
	// router definition. See the `routes.json` file in this folder for
	// the output.
	if *routes {
		// fmt.Println(docgen.JSONRoutesDoc(r))
		fmt.Println(docgen.MarkdownRoutesDoc(r, docgen.MarkdownOpts{
			ProjectPath: "github.com/pressly/chi",
			Intro:       "Welcome to the chi/_examples/rest generated docs.",
		}))
		return
	}

	http.ListenAndServe(":3333", r)
}

type Article struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Article fixture data
var articles = []*Article{
	{ID: "1", Title: "Hi"},
	{ID: "2", Title: "sup"},
}

// ArticleCtx middleware is used to load an Article object from
// the URL parameters passed through as the request. In case
// the Article could not be found, we stop here and return a 404.
func ArticleCtx(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		articleID := chi.URLParam(r, "articleID")
		article, err := dbGetArticle(articleID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, http.StatusText(http.StatusNotFound))
			return
		}
		ctx := context.WithValue(r.Context(), "article", article)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// SearchArticles searches the Articles data for a matching article.
// It's just a stub, but you get the idea.
func SearchArticles(w http.ResponseWriter, r *http.Request) {
	// Filter by query param, and search...
	render.JSON(w, r, articles)
}

// ListArticles returns an array of Articles.
func ListArticles(w http.ResponseWriter, r *http.Request) {
	render.JSON(w, r, articles)
}

// CreateArticle persists the posted Article and returns it
// back to the client as an acknowledgement.
func CreateArticle(w http.ResponseWriter, r *http.Request) {
	var data struct {
		*Article
		OmitID interface{} `json:"id,omitempty"` // prevents 'id' from being set
	}
	// ^ the above is a nifty trick for how to omit fields during json unmarshalling
	// through struct composition

	if err := render.Bind(r.Body, &data); err != nil {
		render.JSON(w, r, err.Error())
		return
	}

	article := data.Article
	dbNewArticle(article)

	render.JSON(w, r, article)
}

// GetArticle returns the specific Article. You'll notice it just
// fetches the Article right off the context, as its understood that
// if we made it this far, the Article must be on the context. In case
// its not due to a bug, then it will panic, and our Recoverer will save us.
func GetArticle(w http.ResponseWriter, r *http.Request) {
	// Assume if we've reach this far, we can access the article
	// context because this handler is a child of the ArticleCtx
	// middleware. The worst case, the recoverer middleware will save us.
	article := r.Context().Value("article").(*Article)

	// chi provides a basic companion subpackage "github.com/pressly/chi/render", however
	// you can use any responder compatible with net/http.
	render.JSON(w, r, article)
}

// UpdateArticle updates an existing Article in our persistent store.
func UpdateArticle(w http.ResponseWriter, r *http.Request) {
	article := r.Context().Value("article").(*Article)

	data := struct {
		*Article
		OmitID interface{} `json:"id,omitempty"` // prevents 'id' from being overridden
	}{Article: article}

	if err := render.Bind(r.Body, &data); err != nil {
		render.JSON(w, r, err)
		return
	}
	article = data.Article

	render.JSON(w, r, article)
}

// DeleteArticle removes an existing Article from our persistent store.
func DeleteArticle(w http.ResponseWriter, r *http.Request) {
	var err error

	// Assume if we've reach this far, we can access the article
	// context because this handler is a child of the ArticleCtx
	// middleware. The worst case, the recoverer middleware will save us.
	article := r.Context().Value("article").(*Article)

	article, err = dbRemoveArticle(article.ID)
	if err != nil {
		render.JSON(w, r, err)
		return
	}

	// Respond with the deleted object, up to you.
	render.JSON(w, r, article)
}

// A completely separate router for administrator routes
func adminRouter() chi.Router {
	r := chi.NewRouter()
	r.Use(AdminOnly)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("admin: index"))
	})
	r.Get("/accounts", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("admin: list accounts.."))
	})
	r.Get("/users/:userId", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fmt.Sprintf("admin: view user id %v", chi.URLParam(r, "userId"))))
	})
	return r
}

// AdminOnly middleware restricts access to just administrators.
func AdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isAdmin, ok := r.Context().Value("acl.admin").(bool)
		if !ok || !isAdmin {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// paginate is a stub, but very possible to implement middleware logic
// to handle the request params for handling a paginated request.
func paginate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// just a stub.. some ideas are to look at URL query params for something like
		// the page number, or the limit, and send a query cursor down the chain
		next.ServeHTTP(w, r)
	})
}

//--

// Below are a bunch of helper functions that mock some kind of storage

func dbNewArticle(article *Article) (string, error) {
	article.ID = fmt.Sprintf("%d", rand.Intn(100)+10)
	articles = append(articles, article)
	return article.ID, nil
}

func dbGetArticle(id string) (*Article, error) {
	for _, a := range articles {
		if a.ID == id {
			return a, nil
		}
	}
	return nil, errors.New("article not found.")
}

func dbRemoveArticle(id string) (*Article, error) {
	for i, a := range articles {
		if a.ID == id {
			articles = append((articles)[:i], (articles)[i+1:]...)
			return a, nil
		}
	}
	return nil, errors.New("article not found.")
}
