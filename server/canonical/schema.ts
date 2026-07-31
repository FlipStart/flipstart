/**
 * CanonicalAnalysisV1 strict response schema.
 *
 * Held as a TypeScript constant rather than read from a .json file at runtime:
 * the server is bundled by esbuild (`--packages=external --bundle`) into
 * dist/index.js, and a runtime fs.readFile against a path that only exists in
 * the source tree would break in production. Bundling the literal removes the
 * failure mode entirely.
 *
 * Strict-mode constraints deliberately honoured:
 *   - additionalProperties:false on every object
 *   - every property listed in `required` (absence is expressed as an "unknown"
 *     enum member, "" , [] or null — never a missing key)
 *   - NO minimum/maximum/maxLength/maxItems/pattern. OpenAI rejects those in
 *     strict mode on at least some API paths, and a rejection is a hard 400 on
 *     every scan. Every one of those bounds is enforced in semantic validation
 *     instead — see server/canonical/validate.ts.
 *   - nesting depth is exactly 5, OpenAI's ceiling. Nothing further may nest
 *     inside an evidence object.
 */
import crypto from "node:crypto";

export const CANONICAL_SCHEMA_NAME = "flipstart_canonical_v1";
export const SCHEMA_VERSION = "1" as const;

export const CANONICAL_SCHEMA_V1: Record<string, unknown> = {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "identification",
      "visible_attributes",
      "photo_evidence",
      "era",
      "condition",
      "marketability",
      "pricing",
      "risks",
      "features"
    ],
    "properties": {
      "identification": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "generic_item_name",
          "canonical_brand",
          "brand_confidence",
          "broad_category",
          "item_type",
          "subtype",
          "subject",
          "team",
          "artist",
          "event",
          "character_or_license",
          "product_line",
          "model_or_product_number",
          "identity_confidence",
          "identification_evidence"
        ],
        "properties": {
          "generic_item_name": {
            "type": "string"
          },
          "canonical_brand": {
            "type": "string"
          },
          "brand_confidence": {
            "type": "integer"
          },
          "broad_category": {
            "type": "string",
            "enum": [
              "clothing",
              "shoes",
              "bags",
              "accessories",
              "jewelry",
              "watches",
              "electronics",
              "housewares",
              "media",
              "toys",
              "sporting_goods",
              "furniture",
              "collectibles",
              "other",
              "unknown"
            ]
          },
          "item_type": {
            "type": "string"
          },
          "subtype": {
            "type": "string"
          },
          "subject": {
            "type": "string"
          },
          "team": {
            "type": "string"
          },
          "artist": {
            "type": "string"
          },
          "event": {
            "type": "string"
          },
          "character_or_license": {
            "type": "string"
          },
          "product_line": {
            "type": "string"
          },
          "model_or_product_number": {
            "type": "string"
          },
          "identity_confidence": {
            "type": "integer"
          },
          "identification_evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "field",
                "observation",
                "evidence_mode",
                "photo_slot"
              ],
              "properties": {
                "field": {
                  "type": "string",
                  "enum": [
                    "canonical_brand",
                    "item_type",
                    "subtype",
                    "subject",
                    "team",
                    "artist",
                    "event",
                    "character_or_license",
                    "product_line",
                    "model_or_product_number",
                    "other"
                  ]
                },
                "observation": {
                  "type": "string"
                },
                "evidence_mode": {
                  "type": "string",
                  "enum": [
                    "direct_transcription",
                    "visual_observation",
                    "inference"
                  ]
                },
                "photo_slot": {
                  "type": "string",
                  "enum": [
                    "front",
                    "tag",
                    "detail"
                  ]
                }
              }
            }
          }
        }
      },
      "visible_attributes": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "size_label",
          "size_system",
          "size_source",
          "primary_color",
          "secondary_colors",
          "color_confidence",
          "material_composition",
          "material_source",
          "material_confidence",
          "style_labels"
        ],
        "properties": {
          "size_label": {
            "type": "string"
          },
          "size_system": {
            "type": "string",
            "enum": [
              "alpha",
              "numeric",
              "waist_inseam",
              "shoe",
              "other",
              "unknown"
            ]
          },
          "size_source": {
            "type": "string",
            "enum": [
              "tag_legible",
              "not_visible",
              "unknown"
            ]
          },
          "primary_color": {
            "type": "string"
          },
          "secondary_colors": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "color_confidence": {
            "type": "integer"
          },
          "material_composition": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "material_source": {
            "type": "string",
            "enum": [
              "tag_legible",
              "visual_estimate",
              "unknown"
            ]
          },
          "material_confidence": {
            "type": "integer"
          },
          "style_labels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "photo_evidence": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "observable_field_evidence",
          "missing_or_unreadable_evidence",
          "recommended_rescan_photo"
        ],
        "properties": {
          "observable_field_evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "field",
                "observation",
                "photo_slot"
              ],
              "properties": {
                "field": {
                  "type": "string",
                  "enum": [
                    "size_label",
                    "primary_color",
                    "secondary_colors",
                    "material_composition",
                    "style_labels",
                    "closure_type",
                    "collar_type",
                    "hood_present",
                    "pocket_configuration",
                    "logo_identity",
                    "logo_placement",
                    "logo_scale",
                    "material_signals",
                    "construction_signals",
                    "stitching_signals",
                    "silhouette",
                    "tag_characteristics",
                    "manufacturing_clues"
                  ]
                },
                "observation": {
                  "type": "string"
                },
                "photo_slot": {
                  "type": "string",
                  "enum": [
                    "front",
                    "tag",
                    "detail"
                  ]
                }
              }
            }
          },
          "missing_or_unreadable_evidence": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "recommended_rescan_photo": {
            "type": "string"
          }
        }
      },
      "era": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "era_status",
          "production_decade",
          "style_era",
          "estimated_era_range",
          "era_confidence",
          "era_evidence",
          "conflicting_era_evidence"
        ],
        "properties": {
          "era_status": {
            "type": "string",
            "enum": [
              "confirmed_vintage",
              "likely_vintage",
              "vintage_inspired",
              "modern",
              "unknown"
            ]
          },
          "production_decade": {
            "type": "string",
            "enum": [
              "pre_1950s",
              "1950s",
              "1960s",
              "1970s",
              "1980s",
              "1990s",
              "2000s",
              "2010s",
              "2020s",
              "unknown"
            ]
          },
          "style_era": {
            "type": "string",
            "enum": [
              "y2k",
              "retro_1950s",
              "retro_1960s",
              "retro_1970s",
              "retro_1980s",
              "retro_1990s",
              "none",
              "unknown"
            ]
          },
          "estimated_era_range": {
            "type": "string"
          },
          "era_confidence": {
            "type": "integer"
          },
          "era_evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "observation",
                "type",
                "proposed_strength",
                "supports",
                "observed_year",
                "photo_slot"
              ],
              "properties": {
                "observation": {
                  "type": "string"
                },
                "type": {
                  "type": "string",
                  "enum": [
                    "manufacturing_date",
                    "copyright_date",
                    "dated_event",
                    "model_or_date_code",
                    "documented_tag_format",
                    "logo_version",
                    "union_label",
                    "care_label_format",
                    "construction",
                    "stitching",
                    "hardware",
                    "material_technology",
                    "country_of_manufacture",
                    "style_only",
                    "other"
                  ]
                },
                "proposed_strength": {
                  "type": "string",
                  "enum": [
                    "hard",
                    "strong_supporting",
                    "weak_supporting"
                  ]
                },
                "supports": {
                  "type": "string",
                  "enum": [
                    "pre_1950s",
                    "1950s",
                    "1960s",
                    "1970s",
                    "1980s",
                    "1990s",
                    "2000s",
                    "2010s",
                    "2020s",
                    "vintage_broad",
                    "modern_broad",
                    "unknown"
                  ]
                },
                "observed_year": {
                  "anyOf": [
                    {
                      "type": "integer"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "photo_slot": {
                  "type": "string",
                  "enum": [
                    "front",
                    "tag",
                    "detail"
                  ]
                }
              }
            }
          },
          "conflicting_era_evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "observation",
                "conflicts_with",
                "proposed_strength",
                "photo_slot"
              ],
              "properties": {
                "observation": {
                  "type": "string"
                },
                "conflicts_with": {
                  "type": "string"
                },
                "proposed_strength": {
                  "type": "string",
                  "enum": [
                    "hard",
                    "strong_supporting",
                    "weak_supporting"
                  ]
                },
                "photo_slot": {
                  "type": "string",
                  "enum": [
                    "front",
                    "tag",
                    "detail"
                  ]
                }
              }
            }
          }
        }
      },
      "condition": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "condition_findings",
          "visible_condition_observations",
          "condition_confidence",
          "condition_unknowns"
        ],
        "properties": {
          "condition_findings": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "type",
                "location",
                "severity",
                "certainty",
                "photo_slot",
                "evidence"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "possible_stain",
                    "hole",
                    "tear",
                    "cracking",
                    "peeling",
                    "broken_hardware",
                    "missing_component",
                    "repair",
                    "heavy_wear",
                    "other"
                  ]
                },
                "location": {
                  "type": "string"
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "minor",
                    "moderate",
                    "major",
                    "unknown"
                  ]
                },
                "certainty": {
                  "type": "integer"
                },
                "photo_slot": {
                  "type": "string",
                  "enum": [
                    "front",
                    "tag",
                    "detail"
                  ]
                },
                "evidence": {
                  "type": "string"
                }
              }
            }
          },
          "visible_condition_observations": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "condition_confidence": {
            "type": "integer"
          },
          "condition_unknowns": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "marketability": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "expected_sell_speed",
          "sell_likelihood",
          "buyer_pool",
          "competition_level",
          "marketability_confidence",
          "marketability_reasons"
        ],
        "properties": {
          "expected_sell_speed": {
            "type": "string",
            "enum": [
              "fast",
              "moderate",
              "slow",
              "very_slow",
              "unknown"
            ]
          },
          "sell_likelihood": {
            "type": "string",
            "enum": [
              "high",
              "moderate",
              "low",
              "very_low",
              "unknown"
            ]
          },
          "buyer_pool": {
            "type": "string",
            "enum": [
              "broad",
              "moderate",
              "narrow",
              "very_narrow",
              "unknown"
            ]
          },
          "competition_level": {
            "type": "string",
            "enum": [
              "low",
              "moderate",
              "high",
              "unknown"
            ]
          },
          "marketability_confidence": {
            "type": "integer"
          },
          "marketability_reasons": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "pricing": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "ai_estimated_resale_range",
          "price_confidence",
          "pricing_basis",
          "pricing_unknowns"
        ],
        "properties": {
          "ai_estimated_resale_range": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "low",
              "high"
            ],
            "properties": {
              "low": {
                "anyOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "high": {
                "anyOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          },
          "price_confidence": {
            "type": "integer"
          },
          "pricing_basis": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "pricing_unknowns": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "risks": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "risk_flags",
          "authenticity_concerns",
          "escalation_signals"
        ],
        "properties": {
          "risk_flags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "authenticity_concerns": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "escalation_signals": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "features": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "closure_type",
          "collar_type",
          "hood_present",
          "pocket_configuration",
          "logo_identity",
          "logo_placement",
          "logo_scale",
          "material_signals",
          "construction_signals",
          "stitching_signals",
          "silhouette",
          "tag_characteristics",
          "manufacturing_clues"
        ],
        "properties": {
          "closure_type": {
            "type": "string",
            "enum": [
              "zip_full",
              "zip_quarter",
              "zip_half",
              "button",
              "snap",
              "pullover",
              "drawstring",
              "buckle",
              "none",
              "unknown"
            ]
          },
          "collar_type": {
            "type": "string",
            "enum": [
              "crew",
              "v_neck",
              "hood",
              "mock",
              "polo",
              "corduroy",
              "ribbed",
              "shirt_collar",
              "none",
              "unknown"
            ]
          },
          "hood_present": {
            "type": "string",
            "enum": [
              "yes",
              "no",
              "unknown"
            ]
          },
          "pocket_configuration": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "logo_identity": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "logo_placement": {
            "type": "string",
            "enum": [
              "center_chest",
              "left_chest",
              "right_chest",
              "full_front",
              "back",
              "sleeve",
              "hem",
              "allover",
              "none",
              "unknown"
            ]
          },
          "logo_scale": {
            "type": "string",
            "enum": [
              "large",
              "medium",
              "small",
              "unknown"
            ]
          },
          "material_signals": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "construction_signals": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "stitching_signals": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "silhouette": {
            "type": "string",
            "enum": [
              "boxy",
              "fitted",
              "oversized",
              "relaxed",
              "cropped",
              "long",
              "unknown"
            ]
          },
          "tag_characteristics": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "manufacturing_clues": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    }
  };

/** Stamped onto every analysis so a stored result is attributable to the exact
 *  schema that produced it. */
export const CANONICAL_SCHEMA_HASH: string =
  "sha256:" + crypto.createHash("sha256")
    .update(JSON.stringify(CANONICAL_SCHEMA_V1))
    .digest("hex")
    .slice(0, 16);

/** The response_format block passed to OpenAI. */
export function canonicalResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: CANONICAL_SCHEMA_NAME,
      strict: true,
      schema: CANONICAL_SCHEMA_V1,
    },
  };
}