package render

import (
	"encoding/json"
	"io"
	"io/ioutil"
)

// Bind is a short-hand method for decoding a JSON request body.
func Bind(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return json.NewDecoder(r).Decode(v)
}
