package v2

import (
	"context"
	"fmt"

	"github.com/pressly/chi/_examples/render/presenter/v3"
	"github.com/pressly/chi/render"
)

// Article presented in API version 2.
type Article struct {
	*v3.Article `json:",inline" xml:",inline"`

	// Additional fields.
	SelfURL string `json:"self_url" xml:"self_url"`

	// Omitted fields.
	URL interface{} `json:"url,omitempty" xml:"url,omitempty"`
}

var Presenter = render.NewPresenter(ArticleV3ToV2)

func init() {
	Presenter.RegisterFrom(v3.Presenter)
}

func ArticleV3ToV2(ctx context.Context, from *v3.Article) (*Article, error) {
	to := &Article{
		Article: from,
		SelfURL: fmt.Sprintf("http://localhost:3333/v2?id=%v", from.ID),
	}
	to.Version = "v2"
	return to, nil
}