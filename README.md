Bommer
- 
Combine guitar pedal BOMs and get Tayda Quick Order Output!


`npm install`

`node bommer.js [FILE].pdf`

or

`node bommer.js [DIRECTORY OF PDFS]`

Flags: 

- `--d` debug logging - useful for sanity checking when combining large numbers of PDFs
- `--v` verbose logging


Tested BOMs
-

- PedalPCB modern, one item per row (location, value, type, notes)
- Effects Layouts modern "Shopping List"
- Generic multi-column location/component BOMs - These are less reliable, run them with the `--d` flag and check the parsing


Sample Output
- 

```
bommer % node bommer.js ./pdfs
Processed file BellumMKII-PedalPCB.pdf - Detected BOM Type: Parts List, Parts Found: 49, Unique Items: 26
Processed file Long-Tom-build-doc.pdf - Detected BOM Type: Shopping List, Parts Found: 34, Unique Items: 28

=== Final Consolidated BOM ===
┌─────────┬─────────────────┬──────────┬──────────┐
│ (index) │ type            │ value    │ quantity │
├─────────┼─────────────────┼──────────┼──────────┤
│ 0       │ 'ceramic'       │ '100p'   │ 1        │
│ 1       │ 'ceramic'       │ '470p'   │ 2        │
│ 2       │ 'ceramic'       │ '680p'   │ 1        │
│ 3       │ 'diode'         │ '1N34A'  │ 2        │
│ 4       │ 'diode'         │ '1N5817' │ 2        │
│ 5       │ 'electrolytic'  │ '100u'   │ 2        │
│ 6       │ 'electrolytic'  │ '10u'    │ 1        │
│ 7       │ 'electrolytic'  │ '1u'     │ 1        │
│ 8       │ 'electrolytic'  │ '3.3u'   │ 1        │
│ 9       │ 'electrolytic'  │ '4.7u'   │ 2        │
│ 10      │ 'film'          │ '100n'   │ 8        │
│ 11      │ 'film'          │ '10n'    │ 1        │
│ 12      │ 'film'          │ '1n'     │ 1        │
│ 13      │ 'film'          │ '2.2n'   │ 1        │
│ 14      │ 'film'          │ '22n'    │ 1        │
│ 15      │ 'film'          │ '47n'    │ 1        │
│ 16      │ 'film'          │ '6.8n'   │ 1        │
│ 17      │ 'ic'            │ 'TL071'  │ 1        │
│ 18      │ 'potentiometer' │ 'A100K'  │ 2        │
│ 19      │ 'potentiometer' │ 'B100K'  │ 3        │
│ 20      │ 'potentiometer' │ 'B1K'    │ 1        │
│ 21      │ 'potentiometer' │ 'B50K'   │ 1        │
│ 22      │ 'resistor'      │ '1.5K'   │ 2        │
│ 23      │ 'resistor'      │ '100K'   │ 7        │
│ 24      │ 'resistor'      │ '100R'   │ 1        │
│ 25      │ 'resistor'      │ '10K'    │ 2        │
│ 26      │ 'resistor'      │ '15K'    │ 3        │
│ 27      │ 'resistor'      │ '1K'     │ 3        │
│ 28      │ 'resistor'      │ '1M'     │ 3        │
│ 29      │ 'resistor'      │ '2.2K'   │ 2        │
│ 30      │ 'resistor'      │ '33K'    │ 1        │
│ 31      │ 'resistor'      │ '390R'   │ 2        │
│ 32      │ 'resistor'      │ '4.7K'   │ 2        │
│ 33      │ 'resistor'      │ '430K'   │ 1        │
│ 34      │ 'resistor'      │ '43K'    │ 1        │
│ 35      │ 'resistor'      │ '470K'   │ 3        │
│ 36      │ 'resistor'      │ '47R'    │ 1        │
│ 37      │ 'resistor'      │ '560R'   │ 1        │
│ 38      │ 'resistor'      │ '6.8K'   │ 1        │
│ 39      │ 'resistor'      │ '8.2K'   │ 2        │
│ 40      │ 'resistor'      │ '820R'   │ 1        │
│ 41      │ 'switch'        │ 'SPDT'   │ 1        │
│ 42      │ 'switch'        │ 'SPST'   │ 1        │
│ 43      │ 'transistor'    │ '2N5088' │ 4        │
│ 44      │ 'transistor'    │ '2N5457' │ 1        │
└─────────┴─────────────────┴──────────┴──────────┘

=== Tayda Quick Order ===
A-4170,10
A-968,10
A-541,10
A-159,2
A-4538,2
A-4554,1
A-4505,1
A-4524,1
A-4555,2
A-564,8
A-559,1
A-557,1
A-558,1
A-560,1
A-563,1
A-421,1
A-1135,1
A-5521,2
A-5519,3
A-5409,1
A-5524,1
A-2202,10
A-2248,10
A-2245,10
A-2203,10
A-2182,10
A-2200,10
A-2277,10
A-2341,10
A-2290,10
A-2315,10
A-2310,10
A-2779,10
A-2774,10
A-2180,10
A-2190,10
A-2282,10
A-2328,10
A-2337,10
A-2323,10
A-095,4
A-6779,1

=== Parts still to order manually ===
┌─────────┬──────────┬─────────┬──────────┐
│ (index) │ type     │ value   │ quantity │
├─────────┼──────────┼─────────┼──────────┤
│ 0       │ 'diode'  │ '1N34A' │ 2        │
│ 1       │ 'switch' │ 'SPDT'  │ 1        │
│ 2       │ 'switch' │ 'SPST'  │ 1        │
└─────────┴──────────┴─────────┴──────────┘
```