package data

import (
	"errors"
	"net/http"

	"github.com/pressly/chi/render"
)

var (
	ErrUnauthorized = errors.New("Unauthorized")
	ErrForbidden    = errors.New("Forbidden")
	ErrNotFound     = errors.New("Resource not found")
)

func PresentError(r *http.Request, err error) (*http.Request, interface{}) {
	switch err {
	case ErrUnauthorized:
		r = render.Status(r, 401)
	case ErrForbidden:
		r = render.Status(r, 403)
	case ErrNotFound:
		r = render.Status(r, 404)
	default:
		r = render.Status(r, 500)
	}
	return r, map[string]string{"error": err.Error()}
}
