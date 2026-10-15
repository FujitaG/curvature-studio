# Using Curvature Studio

## Draw and calculate

Start with Cube/K₄ or open Templates. Select moves vertices; Bond adds a graph
edge; Brace makes a rigid connection. **Structural role** in the Inspector changes
Bond/Brace and therefore the quotient and calculation. Single/double/dashed line
styles only change appearance. Curvature is recomputed after structural edits.
Coordinates have no effect on the supported unit-weight calculation.

Results shows drawn edges, with searchable IDs, sorting and continuous scrolling.
Selecting an edge ID locates it. Histogram counts **quotient bonds once**, while
Results/CSV contains drawn bonds individually: parallel contacts after contraction
can share a value. Braces and intra-unit Bonds have no numerical curvature.
`Converged` describes the heuristic stopping criterion, not a mathematical error
certificate. Stop/Retry is available for expensive calculations.

## Panels, colors and camera

Use **Panels** to restore Histogram, Inspector or Interaction guide after closing
them. **Restore default panels** restores panel visibility and positions without
clearing the graph. Floating panel headers support drag, arrow keys, Shift+arrows
and Home. The Interaction guide opens on a first visit; saved preferences apply
on subsequent visits. Fit view fits the available drawing area; manual camera
adjustments remain manual until Fit is invoked again.

Histogram → Color threshold controls the transition location and width while the
graph remains visible. Width zero is a hard cutoff; other widths interpolate.
Use default colors restores the current metric's standard coloring. These settings
do not modify the computed numbers. Detailed colors are under Display settings.

## Compare two structures

Compare creates A and a copy B with independent edits and undo histories. Open A/B
loads a different project. The distribution panel uses common bins and axes;
Share compares proportions, Count compares numbers of quotient bonds. Rotation
and zoom can be linked; pan is independent.

Single view → Show A/B only hides the other structure. **End comparison…** is the
separate operation for retaining one project and discarding the other. Download
the comparison before ending if both are needed later. Save comparison (A + B)
keeps both even in Single view. Export A/B only saves one side. Ordinary figure
and results export uses the editing side, identified in the export menu.

## Import and preserve work

Open project accepts the project/comparison formats in [FORMATS.md](../FORMATS.md).
Templates → File format & examples explains polyhedron JSON/TXT and supplies
sample downloads. OBJ/STL are not supported. Unsupported weights or calculation
methods are rejected rather than silently reinterpreted. An invalid import leaves
the existing work intact.

The browser saves work locally in IndexedDB; recovery material may also use
localStorage. Different browsers and origins do not share it. Browser data deletion
can remove it. Use downloadable project/comparison files for backup and sharing.
Concurrent tabs do not merge edits: a conflicting writer is paused and offers
recovery/resume actions. Undo history is not included in project files.

New project resets project identity and content. Clear canvas removes graph
content while keeping metadata. These operations differ from restoring panels.
A general non-destructive Reset workspace command is not currently implemented.

## Research outputs

Save project/comparison preserves editable inputs and display settings. Results
JSON records inputs, calculation definition, rigid units, edge mapping, values
and precision/status evidence. CSV contains numeric results rather than the
rounded text shown on screen. It includes all edges even when Results is filtered.

Figure setup (2D) specifies paper dimensions/margins in mm, background, DPI,
label precision/font and whole-graph/current-range output. Preview and export use
the same projection. Save figure settings or download commits the draft; Close
discards unsaved changes. Actual label size includes the Display settings scale.

SVG records physical dimensions. PNG uses the corresponding pixel dimensions but
has no DPI metadata: set physical placement size in the target document. Fonts
are not embedded or outlined. 3D exports the current view and does not yet offer
the 2D paper setup. Inspect the exported image in the target publication workflow;
font substitution and final printed output are not covered by browser QA.
