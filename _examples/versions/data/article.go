package data

// Article is runtime object, that's not meant to be sent via REST.
type Article struct {
	ID                     int      `db:"id" json:"id" xml:"id"`
	Title                  string   `db:"title" json:"title" xml:"title"`
	Data                   []string `db:"data,stringarray" json:"data" xml:"data"`
	CustomDataForAuthUsers string   `db:"custom_data" json:"-" xml:"-"`
}
