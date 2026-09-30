# OpenCircuit KiCad Bridge

Deterministic interoperability between OpenCircuit 1.0 designs and KiCad generic XML netlists. It preserves electrical connectivity, references, values, library identifiers, fields, net labels, source metadata, and unsupported-part diagnostics.

## Capabilities

- Import KiCad generic XML netlists produced by the Schematic Editor.
- Export OpenCircuit designs as deterministic KiCad-compatible XML netlists.
- Resistors, capacitors, inductors, diodes, LEDs, DC voltage sources, and DC current sources.
- Engineering-value parsing for `p`, `n`, `u`, `m`, `k`, `M`, `G`, and `T` prefixes.
- Ground-net detection with configurable names.
- Strict or warning behavior for unsupported and non-two-terminal symbols.
- Preserve unmapped symbols and KiCad metadata in an OpenCircuit extension block.
- Generate grouped BOMs as structured data or CSV.
- Stable references and XML output for useful Git diffs.

## CLI

In KiCad, generate a generic XML netlist from the Schematic Editor, then run:

```bash
npx oc-kicad import design.net --output circuit.json
npx oc-kicad export circuit.json --output regenerated.net
npx oc-kicad bom circuit.json --output bom.csv
```

Use `--unsupported error` during import when unsupported symbols must fail CI.

## Library

```js
import { importKiCadNetlist, exportKiCadNetlist } from '@opencircuitlabs/kicad-bridge';

const { circuit, warnings, unmapped } = importKiCadNetlist(xml);
const regenerated = exportKiCadNetlist(circuit, { date: '2026-10-01' });
```

## Fidelity boundary

This release intentionally targets KiCad's generic XML netlist interface. A netlist contains electrical components and connectivity, but not graphical schematic placement, wires, annotations, hierarchical sheets, or PCB geometry. The bridge does not claim lossless `.kicad_sch` or `.kicad_pcb` rewriting. Those require separate native-format projects and visual verification.

## License

MIT © 2026 OpenCircuitLabs
