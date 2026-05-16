package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// printTable prints a simple padded table.
// headers: column names. fill: caller invokes row() for each data row.
func printTable(headers []string, fill func(row func(...string))) {
	// collect all rows first so we can compute column widths
	var rows [][]string
	fill(func(cells ...string) {
		rows = append(rows, cells)
	})

	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	for _, r := range rows {
		for i, cell := range r {
			if i < len(widths) && len(cell) > widths[i] {
				widths[i] = len(cell)
			}
		}
	}

	fmtRow := func(cells []string) {
		parts := make([]string, len(headers))
		for i := range headers {
			cell := ""
			if i < len(cells) {
				cell = cells[i]
			}
			if i < len(headers)-1 {
				parts[i] = fmt.Sprintf("%-*s", widths[i], cell)
			} else {
				parts[i] = cell
			}
		}
		fmt.Println(strings.Join(parts, "  "))
	}

	fmtRow(headers)
	sep := make([]string, len(headers))
	for i, w := range widths {
		sep[i] = strings.Repeat("-", w)
	}
	fmtRow(sep)
	for _, r := range rows {
		fmtRow(r)
	}
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
