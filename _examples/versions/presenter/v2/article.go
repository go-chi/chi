package v2

import (
	"fmt"
	"net/http"

	"github.com/pressly/chi/_examples/versions/data"
)

// Article presented in API version 2.
type Article struct {
	// *v3.Article `json:",inline" xml:",inline"`

	*data.Article

	// Additional fields.
	SelfURL string `json:"self_url" xml:"self_url"`

	// Omitted fields.
	URL interface{} `json:"url,omitempty" xml:"url,omitempty"`
}

func (a *Article) Render(w http.ResponseWriter, r *http.Request) error {
	a.SelfURL = fmt.Sprintf("http://localhost:3333/v2?id=%v", a.ID)
	return nil
}

func NewArticleResponse(article *data.Article) *Article {
	return &Article{Article: article}
}
