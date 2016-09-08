package render

import (
	"encoding/json"
	"io"
	"io/ioutil"
	"net/http"
)

var Bind = defaultBind

// defaultBind is a short-hand method for decoding a JSON request body.
func defaultBind(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return json.NewDecoder(r).Decode(v)
}

func Bind2(key, val interface{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	}
}
