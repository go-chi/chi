package chi

// Radix tree implementation is a based on the work by Armon Dadgar
// in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed)

// TODO: case insensitive ..

// TODO: trailing slash stuff...? perhaps in the Mux{} ..?

import (
	"log"
	"sort"
	"strings"

	"golang.org/x/net/context/ctxhttp"
)

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /:id([0-9]+) or /#id([0-9]+)?
	ntParam                   // /:user
	ntCatchAll                // /api/v1/*
)

// WalkFn is used when walking the tree. Takes a
// key and value, returning if iteration should
// be terminated.
// type WalkFn func(s string, v interface{}) bool
// TODO: do we want to have method here..?
type WalkFn func(path string, handler ctxhttp.Handler) bool

// edge is used to represent an edge node
type edge struct {
	label byte
	node  *node
}

type node struct {
	typ nodeTyp // static, param, regexp, catchall ... IDEA/TODO: DO WE MAKE THIS AN EDGETYPE  ........?

	// TODO: .. hmm, so, while inserting a string,
	// we need to check the prefix .. like /:x or /* or /:id(Y)
	// if we do .. /ping/:id/hi and /ping/:sup/hi .. then :sup will overwrite..
	// what if we have /ping/:id/hi and /ping/:sup/bye - the :id and :sup are considered like a single char?

	// prefix is the common prefix we ignore
	prefix string

	// HTTP handler on the leaf node
	handler ctxhttp.Handler

	// Edges should be stored in-order for iteration.
	// We avoid a fully materialized slice to save memory,
	// since in most cases we expect to be sparse
	edges edges

	// TODO
	// nWildEdges int
	// do we keep track of the number of wildEdges somewhere..?
	// a count.. or something?
}

func (n *node) isLeaf() bool {
	return n.handler != nil
}

func (n *node) addEdge(e edge) {
	search := e.node.prefix

	// Split the node on a param type
	p := strings.IndexByte(search, ':') // TODO: or '*' ....... should we use Rune or IndexFunc ..?

	if p == 0 {

		// split the end..
		// log.Println("*** split the end!!")

		handler := e.node.handler

		e.node.typ = ntParam
		p = strings.IndexByte(search, '/')
		if p < 0 {
			p = len(search)
		}
		e.node.prefix = search[:p] // ':' or 'i' ?
		// e.node.handler = nil //????????????

		// log.Println("** end split, len(search) != p", len(search), p)

		if len(search) != p {
			// add trailing child node.., split the end
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

		// split the beginning..
		// log.Println("*** split the beginning!!")

		handler := e.node.handler
		e.node.typ = ntStatic
		e.node.prefix = search[:p]
		e.node.handler = nil

		// now add the param edge node..
		search = search[p:]
		p = strings.IndexByte(search, '/')
		if p < 0 {
			p = len(search)
		}
		e2 := edge{
			label: search[0], // should label be ':' or 'i' ?
			node: &node{
				typ:     ntParam,
				prefix:  search[:p],
				handler: handler,
			},
		}
		e.node.addEdge(e2)
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

func (n *node) findEdge(minTyp nodeTyp, label byte) *node { // rename to matchEdge() ...?
	num := len(n.edges)
	idx := sort.Search(num, func(i int) bool {
		if n.edges[i].node.typ < minTyp {
			return false
		}
		switch n.edges[i].node.typ {
		case ntStatic:
			return n.edges[i].label >= label
		default: // other types...
			return true // TODO: right now we match them all..
		}
		return false
	})

	// log.Printf("!!!!! FIND EDGE num:%d minTyp:%d label:%s idx:%d", num, minTyp, string(label), idx)

	if idx >= num {
		return nil
	}

	// TODO: ... review..
	if n.edges[idx].node.typ == ntStatic && n.edges[idx].label == label {
		return n.edges[idx].node
	} else if n.edges[idx].node.typ > ntStatic { // more match logic here...?
		return n.edges[idx].node // good..?
	}
	return nil
}

func (n *node) findStaticNode(path string) *node { // min/direct typ ........ for other typ searches..?
	sn := n
	search := path
	// TODO: return params, or naw...?

	for {
		if len(search) == 0 {
			if sn.isLeaf() {
				return sn
			}
			break
		}

		sn = sn.findEdge(ntStatic, search[0])

		// log.Printf("FINDSTATICNODE -- findEdge search[0]:%s sn:%v\n", string(search[0]), sn)

		if sn == nil {
			break
		}

		// Consume the search prefix
		if strings.HasPrefix(search, sn.prefix) {
			search = search[len(sn.prefix):]
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

// TODO: I suppose we can have different trees depending on the method...?
// For now, just assume method is always GET

var insertcnt int = -1

// TODO: do we return an error or panic..? what does goji do..
func (t *tree) Insert(method methodTyp, pattern string, handler ctxhttp.Handler) error {

	insertcnt += 1
	// log.Println("")
	// log.Printf("=> INSERT #%d %s\n", insertcnt, pattern)

	var parent *node
	n := t.root
	search := pattern

	iter := -1

	for {
		iter += 1

		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			n.handler = handler
			return nil
		}

		// Look for the edge
		parent = n
		// log.Printf("insert (%d): search[0] %s\n", iter, string(search[0]))
		n = n.getEdge(search[0])

		// if len(search) > 1 {
		// 	log.Printf("cont'd insert, search[1] %s\n", string(search[1]))
		// }

		// No edge, create one
		if n == nil {
			// log.Printf("insert (%d): new edge, prefix %s\n", iter, search)
			e := edge{
				label: search[0],
				node: &node{
					typ:     ntStatic,
					prefix:  search,
					handler: handler,
				},
			}
			parent.addEdge(e)

			return nil
		}

		// log.Printf("insert (%d): prefix:%s\n", iter, n.prefix)

		// Determine longest prefix of the search key on match
		commonPrefix := t.longestPrefix(search, n.prefix)
		// log.Printf("insert (%d): commonPrefix '%s' + '%s'\n", iter, search[:commonPrefix], search[commonPrefix:])
		if commonPrefix == len(n.prefix) {
			search = search[commonPrefix:]
			// log.Printf("insert (%d): commonPrefix == len('%s'), continue\n", iter, n.prefix)
			continue
		}

		// log.Println("=========> SPLIT NODE..........")
		// TODO ********

		// Split the node
		child := &node{
			typ:    ntStatic, // TODO: HMM.. will this always be static...?
			prefix: search[:commonPrefix],
		}
		// log.Printf("insert (%d): split node, parentPrefix:%s, nodePrefix:%s, childPrefix:%s\n", iter, parent.prefix, n.prefix, child.prefix)
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
			// log.Println("*** new key is a subset, add to this node and return...")
			child.handler = handler
			return nil
		}

		// Create a new edge for the node
		// log.Printf("insert (%d): add new edge, label:%s nodePrefix:%s\n", iter, string(search[0]), search)
		child.addEdge(edge{
			label: search[0],
			node: &node{
				prefix:  search,
				handler: handler,
			},
		})
		return nil
	}
	return nil
}

// TODO: this is like Get() ...........
// TODO: 2nd return value is urlParams map[string]string ...
func (t *tree) Find(method methodTyp, path string) (ctxhttp.Handler, map[string]string, error) {
	n := t.root
	search := path
	params := map[string]string{} // alloc each find..?

	var wn *node // wild node
	_ = wn

	for {
		// Check for key exhaustion
		if len(search) == 0 {
			if n.isLeaf() {
				return n.handler, params, nil
			}
			break
		}

		// log.Printf("=> find edge search[0] '%s' on node typ:%d", string(search[0]), n.typ)

		// For some set of edges, we can have static and wild card nodes,
		// that will have multiple matches, but we want to first traverse the static
		// path as it takes precedence over the wild

		// TODO: we can have a numWildEdges flag on a node to avoid searching
		// for wild paths unless we have to

		// Look for an edge
		pn := n                                // parent node
		wn = n.findEdge(ntStatic+1, search[0]) // wild node
		n = n.findEdge(ntStatic, search[0])

		// ^^^^^^^^^^^^^^^^^^^^^^^^^^^ wn and n should be diff for /ping/all .....

		if n == nil && wn == nil {
			// log.Println("!!!!!!!!!!!!!!!!!! FOUND NOTHING AT ALL")
			break // nothing at all
		}

		if n == nil && wn != nil {
			// log.Println("!!!!!!!!!!!!!!!!!! 0 STATIC, 1 WILD")

			n = wn
			// if n.prefix[0] == ':' { // .. or just check the n.typ > ntStatic ... duh.. ez.
			// log.Printf("SOOOOOOOO....... n.prefix:%s search:%s\n", n.prefix, search)
			// log.Println("handler:", n.handler)

			p := strings.IndexByte(search, '/')
			if p < 0 {
				p = len(search)
			}
			params[n.prefix[1:]] = search[:p]
			search = search[p:]
			// log.Printf("search is now:%s on nodePrefix:%s", search, n.prefix)
			continue
			// }
		}

		if n != nil && wn != nil {
			// log.Println("!!!!!!!!!!!!!!!!!! 1 STATIC, 1 WILD")

			// here we have both static and wild node paths

			// first, we try the static node
			// look ahead..? or... n2 := n.findNode(path)   <---<< will search a subset from a given node..

			// WOOTrecursiveWalk(0, 0, n, 0)

			sn := pn.findStaticNode(search)
			// log.Printf("!!!!!!!!!!!!!!!!!!!!!!!!!! searching for static node:'%s' found:%v", search, sn)

			if sn != nil {
				// found a static node
				// log.Printf("!! sn.prefix=%s\n", sn.prefix)
				// n = sn // do nothing..
			} else {
				// use wild node
				n = wn
			}

		}

		//---------------------------------------------------------------------------

		// TODO: hmm so, route /ping/:id should match /ping/123
		// .. we can see from each node, if the typ is param, then..
		if n == nil {
			break
		}

		// log.Println("!! n:", n.prefix)

		// TODO: .. hmm.. seems like I have to do this again...
		if n.prefix[0] == ':' { // .. or just check the n.typ > ntStatic ... duh.. ez.
			// log.Printf("SOOOOOOOO....... n.prefix:%s search:%s\n", n.prefix, search)
			// log.Println("handler:", n.handler)

			p := strings.IndexByte(search, '/')
			if p < 0 {
				p = len(search)
			}
			params[n.prefix[1:]] = search[:p]
			search = search[p:]
			continue
		}

		// TODO: the getEdge need to give us the next index (idx)
		// for the next path too.. or something..

		// TODO: ... HMMM IDEA: maybe there is something to this consuming the search prefix
		// that we can use with static, param, etc..................?

		// Consume the search prefix
		if strings.HasPrefix(search, n.prefix) {
			search = search[len(n.prefix):]
		} else {
			break
		}
	}
	return nil, params, nil
}

// Walk is used to walk the tree
func (t *tree) Walk(fn WalkFn) {
	t.recursiveWalk(t.root, fn)
}

// TODO: remove?
// WalkPrefix is used to walk the tree under a prefix
func (t *tree) WalkPrefix(prefix string, fn WalkFn) {
	n := t.root
	search := prefix
	for {
		// Check for key exhaustion
		if len(search) == 0 {
			t.recursiveWalk(n, fn)
			return
		}

		// Look for an edge
		n = n.getEdge(search[0])
		if n == nil {
			break
		}

		// Consume the search prefix
		if strings.HasPrefix(search, n.prefix) {
			search = search[len(n.prefix):]

		} else if strings.HasPrefix(n.prefix, search) {
			// Child may be under our search prefix
			t.recursiveWalk(n, fn)
			return
		} else {
			break
		}
	}

}

// TODO: remove?
// WalkPath is used to walk the tree, but only visiting nodes
// from the root down to a given leaf. Where WalkPrefix walks
// all the entries *under* the given prefix, this walks the
// entries *above* the given prefix.
// TODO: rename to WalkPrefixReverse ...? or Up ..?
func (t *tree) WalkPath(path string, fn WalkFn) {
	n := t.root
	search := path
	for {
		// Visit the leaf values if any
		if n.handler != nil && fn(path, n.handler) {
			return
		}

		// Check for key exhaustion
		if len(search) == 0 {
			return
		}

		// Look for an edge
		n = n.getEdge(search[0])
		if n == nil {
			return
		}

		// Consume the search prefix
		if strings.HasPrefix(search, n.prefix) {
			search = search[len(n.prefix):]
		} else {
			break
		}
	}
}

// recursiveWalk is used to do a pre-order walk of a node
// recursively. Returns true if the walk should be aborted
func (t *tree) recursiveWalk(n *node, fn WalkFn) bool {
	// Visit the leaf values if any
	if n.handler != nil && fn(n.prefix, n.handler) { // TODO ..... walkFn() ..?
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

//--

func WOOTrecursiveWalk(parent int, i int, n *node, label byte) bool {
	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf(), n.handler)
		// return true
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf())
	}

	parent = i
	for _, e := range n.edges {
		i++
		if WOOTrecursiveWalk(parent, i, e.node, e.label) {
			return true
		}
	}
	return false
}
