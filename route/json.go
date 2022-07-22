// Package route contains helpers for automatically unmarshalling requests.
// This helps to reduce boilerplate in request handlers.
package route

import (
	"encoding/json"
	"net/http"
)

// JSON automatically unmarshals the body into a value of type T.
// If the unmarshal fails, it returns 422 Unprocessable Entity.
func JSON[T any](f func(http.ResponseWriter, *http.Request, T)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var t T

		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		f(w, r, t)
	}
}
