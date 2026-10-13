# Product card specifications

Product fronts show up to five purchase-relevant rows. The selection is a read-only projection; it does not change saved specifications, their IDs, images, lanes, prices, colors or SKU bindings. Details continues to show the complete technical specifications.

`public/js/card-specs.js` provides the shared selector. Both canvas drawing and card-height calculation use it. PowerPoint records that same card drawing as editable text and shapes with the original artwork; export has no separate specification selection. Each category sizes all its cards together from the selected rows and existing SKU footers, so filtering does not change their geometry.

Priorities are evaluated in the order below; missing values are skipped. Fewer than five useful rows is expected when a product has limited saved information. Warranty, box contents, legal text, dates, source metadata, placeholders and unrecognized fields never fill empty summary slots. There is no specification-count message.

| Product kind | Priority order |
| --- | --- |
| Microphone | Connection; recording limits; capsule construction and polar patterns; headphone monitoring; controls. Mount/filter support and lighting are fallbacks. Platform and OS lists stay in Details. |
| Wired headset | Connection; drivers; microphone; cushion/fit; audio features. |
| Wireless headset | Battery life; connection modes; drivers; microphone; cushion/fit. |
| Console headset | Actual console fit comes first, followed by connection/battery and the headset priorities. |
| Earbuds | Audio/noise cancellation; battery; connection; ear-tip fit; drivers. |
| Keyboard | Form factor; switch technology/feel/model; connection; customization; polling. Keycap material, mounting and lighting fill missing slots. Wireless models prioritize battery life. |
| Mouse | Weight; connection; shape/sensor; polling. Wireless models prioritize battery life. |
| Mat | Dimensions/size; surface; base/edge features; lighting when supported. |
| Wrist rest | Dimensions/size; padding; functional features; weight. |
| Switch pack | Feel; actuation force; travel; pin/mount fit; keyboard fit. |
| Housing / top plate / keycaps | Exact supported model/stem fit; relevant material; attachment/assembly; finish; dimensions. |
| Skates | Supported mouse fit; skate material; attachment; functional features; dimensions. |
| Decorations / figurines | Supported physical fit, attachment, design, material and size where saved. Administrative-only records can have no summary rows. |
| Webcam | Video resolution/frame rate; field of view; focus; camera capabilities; connection. Swivel/tilt and privacy are fallbacks. |
| Game controller | Connection; explicitly identified stick technology or saved switch technology; supported console/device fit; controls; battery. |
| Leverless arcade controller | Form factor; connection; supported console/device fit; actuation adjustment; input feel. A generic switch field is never relabeled as a stick sensor. |
| Charging dock | Controller charging capacity; exact controller fit; charging time/method; actual connection; charge indicators. Capacity retains “not included” conditions. |
| Audio mixer | Microphone input ports; line/headphone ports; connection; mixing/routing; audio-quality limits. |
| Microphone arm | Load/thread fit; reach; mount; desk clamp fit; functional features. |
| Pop filter | Attachment/model fit; screen dimensions/material; gooseneck reach. |
| Microphone cable | Connectors; length; jacket/insulation; wire gauge; conductors. |
| Sound card | Host connection; headset input; audio processing; controls/features. |
| Backpack | Capacity; laptop fit; physical size; compartments; carrying features. |

Repeated aliases occupy one role. Combined rows retain the IDs of their contributing saved rows. SKU-scoped values become one common value only when every displayed scope belongs to the product's actual bindings and all scoped values agree. Different interfaces, conditions or unknown scopes remain distinct. Polar-pattern ordering alone does not create a difference.

Card titles keep the existing font and two-line frame. The wrapper fills the final permitted line before adding an ellipsis. Exact Cloth Pulsefire Mat titles omit the repeated “Gaming Mouse Pad” phrase on product fronts so the material, M/L/XL/2XL size and WM suffix remain visible. Their complete canonical names stay in saved data, search, Details and editing; editable PowerPoint uses the same front title.

Clean recording-rate and bit-depth lists show their separate explicit maxima using “up to” for lists. This does not assert that two independent maxima form a supported combination. Conditional values are preserved instead of shortened. Capsule diameter is omitted from the front construction summary; the full value remains in Details.

The synthetic checks in `scripts/checks/card-specs.mjs` cover the selector, the actual layout/drawing path, exported-category selection and deployment closure. Existing product-details and editable-PowerPoint checks continue to verify complete Details, images, grouped editable objects and lane pagination.
