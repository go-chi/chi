package v1

import (
	"net/http"

	"github.com/pressly/chi/_examples/versions/data"
)

// Article presented in API version 1.
type Article struct {
	*data.Article

	Data map[string]bool `json:"data" xml:"data"`
}

func (a *Article) Render(w http.ResponseWriter, r *http.Request) error {
	return nil
}

func NewArticleResponse(article *data.Article) *Article {
	return &Article{Article: article}
}
