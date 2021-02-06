package data

import (
	"errors"
	"net/http"

	"github.com/go-chi/render"
)

var (
	ErrUnauthorized = errors.New("Unauthorized")
	ErrForbidden    = errors.New("Forbidden")
	ErrNotFound     = errors.New("Resource not found")
)

func PresentError(r *http.Request, err error) (*http.Request, interface{}) {
	switch err {
	case ErrUnauthorized:
		render.Status(r, http.StatusUnauthorized)
	case ErrForbidden:
		render.Status(r, http.StatusForbidden)
	case ErrNotFound:
		render.Status(r, http.StatusNotFound)
	default:
		render.Status(r, http.StatusInternalServerError)
	}
	return r, map[string]string{"error": err.Error()}
}
