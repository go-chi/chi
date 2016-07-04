package v1

import (
	"context"
	"fmt"

	"github.com/pressly/chi/_examples/render/presenter/v2"
	"github.com/pressly/chi/render"
)

// Article presented in API version 1.
type Article struct {
	*v2.Article `json:",inline" xml:",inline"`

	Data map[string]bool `json:"data" xml:"data"`
}

var Presenter = render.NewPresenter(ArticleV2ToV1)

func init() {
	Presenter.RegisterFrom(v2.Presenter)
}

func ArticleV2ToV1(ctx context.Context, from *v2.Article) (*Article, error) {
	to := &Article{
		Article: from,
		Data:    map[string]bool{},
	}
	to.SelfURL = fmt.Sprintf("http://localhost:3333/v1?id=%v", from.ID)
	to.Version = "v1"
	for _, item := range from.Data {
		to.Data[item] = true
	}
	return to, nil
}
