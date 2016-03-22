package render

import (
	"encoding/json"
	"io"
)

func Bind(r io.Reader, v interface{}) error {
	return json.NewDecoder(r).Decode(v)
}
