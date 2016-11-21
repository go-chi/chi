package render

import "context"

type Builder interface {
	Build(ctx context.Context) (interface{}, error)
}

// TODO: helper method to build list of objects for a response
