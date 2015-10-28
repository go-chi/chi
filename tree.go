package chi

// Radix tree implementation below is a based on the original work by
// Armon Dadgar in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed)

import (
	"errors"
	"sort"
	"strings"
)

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /:id([0-9]+) or #id^[0-9]+$
	ntParam                   // /:user
	ntCatchAll                // /api/v1/*
)

// WalkFn is used when walking the tree. Takes a
// key and value, returning if iteration should
// be terminated.
type WalkFn func(path string, handler Handler) bool

// edge is used to represent an edge node
type edge struct {
	label byte
	node  *node
}

type node struct {
	typ nodeTyp

	// prefix is the common prefix we ignore
	prefix string

	// HTTP handler on the leaf node
	handler Handler

	// Edges should be stored in-order for iteration.
	// We avoid a fully materialized slice to save memory,
	// since in most cases we expect to be sparse
	edges edges

	// TODO: optimization, do we keep track of the number of wildEdges?
	// nWildEdges int // or nWildEdges bool
}

func (n *node) isLeaf() bool {
	return n.handler != nil
}

func (n *node) addEdge(e edge) {
	search := e.node.prefix

	// Find any wildcard segments
	p := strings.IndexAny(search, ":*")

	// Determine new node type
	ntyp := ntStatic
	if p >= 0 {
		switch search[p] {
		case ':':
			ntyp = ntParam
		case '*':
			ntyp = ntCatchAll
		}
	}

	if p == 0 {
		// Path starts with a wildcard

		handler := e.node.handler
		e.node.typ = ntyp

		if ntyp == ntCatchAll {
			p = -1
		} else {
			p = strings.IndexByte(search, '/')
		}
		if p < 0 {
			p = len(search)
		}
		e.node.prefix = search[:p]

		if p != len(search) {
			// add edge for the remaining part, split the end.
			e.node.handler = nil

			search = search[p:]
			e2 := edge{
				label: search[0], // this will always start with /
				node: &node{
					typ:     ntStatic,
					prefix:  search,
					handler: handler,
				},
			}
			e.node.addEdge(e2)
		}

	} else if p > 0 {
		// Path has some wildcard

		// starts with a static segment
		handler := e.node.handler
		e.node.typ = ntStatic
		e.node.prefix = search[:p]
		e.node.handler = nil

		// add the wild edge node
		search = search[p:]

		e2 := edge{
			label: search[0],
			node: &node{
				typ:     ntyp,
				prefix:  search,
				handler: handler,
			},
		}
		e.node.addEdge(e2)

	} else {
		// Path is all static
		e.node.typ = ntyp

	}

	n.edges = append(n.edges, e)
	n.edges.Sort()
}

func (n *node) replaceEdge(e edge) {
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == e.label {
			n.edges[i].node = e.node
			return
		}
	}
	panic("chi: replacing missing edge")
}

func (n *node) getEdge(label byte) *node {
	// We do a linear search as we're sorted by a compound key
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == label {
			return n.edges[i].node
		}
	}
	return nil
}

func (n *node) findEdge(minTyp nodeTyp, label byte) *node {
	num := len(n.edges)
	idx := sort.Search(num, func(i int) bool {
		if n.edges[i].node.typ < minTyp {
			return false
		}
		switch n.edges[i].node.typ {
		case ntStatic:
			return n.edges[i].label >= label
		default: // wild nodes
			// TODO: right now we match them all.. but regexp should
			// run through regexp matcher
			return true
		}
		return false
	})

	if idx >= num {
		return nil
	}

	if n.edges[idx].node.typ == ntStatic && n.edges[idx].label == label {
		return n.edges[idx].node
	} else if n.edges[idx].node.typ > ntStatic {
		return n.edges[idx].node
	}
	return nil
}

func (n *node) findNode(minTyp nodeTyp, path string, params map[string]string) *node {
	nn := n
	search := path

	for {
		if len(search) == 0 {
			if nn.isLeaf() {
				return nn
			}
			break
		}

		// TODO: optimization opportunity to not traverse wild path if there are no
		// wild edges
		wn := nn.findEdge(ntStatic+1, search[0]) // wild node
		nn = nn.findEdge(ntStatic, search[0])    // any node

		if nn == nil && wn == nil {
			// Found nothing at all
			break

		} else if nn == nil && wn != nil {
			// Found only a wild node
			nn = wn

		} else if nn == wn {
			// Same, do nothing.

		} else if nn != nil && wn != nil {
			// Found both static and wild matching nodes

			// TODO: optimization opportunity
			// Attempts to find the final node by going down the static path first

			if len(search) < len(nn.prefix) {
				nn = wn
			} else {
				stsearch := search[len(nn.prefix):]
				if stsearch != "" {
					sn := nn.findNode(ntStatic, stsearch, params)

					// As static leaf couldn't be found, use the wild node
					if sn == nil {
						nn = wn
					}
				}
			}
		}

		if nn.typ > ntStatic {
			p := -1
			if nn.typ != ntCatchAll {
				p = strings.IndexByte(search, '/')
			}
			if p < 0 {
				p = len(search)
			}

			if nn.typ == ntCatchAll {
				params["*"] = search[:p]
			} else {
				params[nn.prefix[1:]] = search[:p]
			}

			search = search[p:]
			continue
		}

		// Consume the search prefix
		if strings.HasPrefix(search, nn.prefix) {
			search = search[len(nn.prefix):]
		} else {
			break
		}
	}
	return nil
}

type edges []edge

func (e edges) Len() int {
	return len(e)
}

// Sort the list of edges by tuple, <edge.node.typ, edge.label>
func (e edges) Less(i, j int) bool {
	if e[i].node.typ < e[j].node.typ {
		return true
	}
	if e[i].node.typ > e[j].node.typ {
		return false
	}
	return e[i].label < e[j].label
}

func (e edges) Swap(i, j int) {
	e[i], e[j] = e[j], e[i]
}

func (e edges) Sort() {
	sort.Sort(e)
}

// Tree implements a radix tree. This can be treated as a
// Dictionary abstract data type. The main advantage over
// a standard hash map is prefix-based lookups and
// ordered iteration.
type tree struct {
	root *node
}

// TODO: do we return an error or panic..? what does goji do..
func (t *tree) Insert(pattern string, handler Handler) error {

	var parent *node
	n := t.root
	search := pattern

	for {
		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			n.handler = handler
			return nil
		}

		// Look for the edge
		parent = n
		n = n.getEdge(search[0])

		// No edge, create one
		if n == nil {
			e := edge{
				label: search[0],
				node: &node{
					prefix:  search,
					handler: handler,
				},
			}
			parent.addEdge(e)

			return nil
		}

		if n.typ > ntStatic {
			// We found a wildcard node, meaning search path starts with
			// a wild prefix. Trim off the wildcard search path and continue.
			p := strings.Index(search, "/")
			if p < 0 {
				p = len(search)
			}
			search = search[p:]
			continue
		}

		// Static node fall below here.
		// Determine longest prefix of the search key on match.
		commonPrefix := t.longestPrefix(search, n.prefix)
		if commonPrefix == len(n.prefix) {
			// the common prefix is as long as the current node's prefix we're attempting to insert.
			// keep the search going.
			search = search[commonPrefix:]
			continue
		}

		// Split the node
		child := &node{
			typ:    ntStatic,
			prefix: search[:commonPrefix],
		}
		parent.replaceEdge(edge{
			label: search[0],
			node:  child,
		})

		// Restore the existing node
		child.addEdge(edge{
			label: n.prefix[commonPrefix],
			node:  n,
		})
		n.prefix = n.prefix[commonPrefix:]

		// If the new key is a subset, add to to this node
		search = search[commonPrefix:]
		if len(search) == 0 {
			child.handler = handler
			return nil
		}

		// Create a new edge for the node
		child.addEdge(edge{
			label: search[0],
			node: &node{
				typ:     ntStatic,
				prefix:  search,
				handler: handler,
			},
		})
		return nil
	}
	return nil
}

// TODO: do we need to return error... or just return nil handler?
func (t *tree) Find(path string, params map[string]string) (Handler, error) {
	node := t.root.findNode(ntStatic, path, params)

	if node == nil || node.handler == nil {
		return nil, errors.New("not found..")
	}

	return node.handler, nil
}

// Walk is used to walk the tree
func (t *tree) Walk(fn WalkFn) {
	t.recursiveWalk(t.root, fn)
}

// recursiveWalk is used to do a pre-order walk of a node
// recursively. Returns true if the walk should be aborted
func (t *tree) recursiveWalk(n *node, fn WalkFn) bool {
	// Visit the leaf values if any
	if n.handler != nil && fn(n.prefix, n.handler) {
		return true
	}

	// Recurse on the children
	for _, e := range n.edges {
		if t.recursiveWalk(e.node, fn) {
			return true
		}
	}
	return false
}

// longestPrefix finds the length of the shared prefix
// of two strings
func (t *tree) longestPrefix(k1, k2 string) int {
	max := len(k1)
	if l := len(k2); l < max {
		max = l
	}
	var i int
	for i = 0; i < max; i++ {
		if k1[i] != k2[i] {
			break
		}
	}
	return i
}
