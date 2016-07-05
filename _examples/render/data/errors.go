package data

import "errors"

var (
	ErrUnauthorized = errors.New("Random error: Unauthorized")
	ErrForbidden    = errors.New("Random error: Forbidden")
	ErrNotFound     = errors.New("Random error: Resource not found")
)
