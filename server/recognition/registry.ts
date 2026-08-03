/**
 * Specific-product recognition definitions.
 *
 * The PROMPT teaches the model zero products. It reports observable features;
 * this registry decides what they add up to. That moves an unreliable judgement
 * out of a general vision model and into code you can unit-test.
 *
 * ALL definitions ship with enabled_in_production:false. A definition earns
 * production status by passing positive, negative, near-match, direct-ID,
 * false-positive, and false-negative examples — not by looking reasonable.
 * The metric that matters is the false-positive rate: a missed Detroit Jacket
 * costs a Diamond, a false one costs trust.
 */
export type AttrOp = "equals_ci" | "in" | "contains_any" | "equals";

export interface AttrTest {
  field: string;          // dotted path into the canonical AI object
  op: AttrOp;
  value: string | string[] | boolean;
  weight?: number;
}

export interface RecognitionDefinition {
  recognition_id: string;
  canonical_name: string;
  applicable_category: string[];
  required_attributes: AttrTest[];
  supporting_attributes: AttrTest[];
  disqualifying_attributes: AttrTest[];
  candidate_threshold: number;
  confirmed_threshold: number;
  minimum_evidence: number;
  required_photos: Array<"front" | "tag" | "detail">;
  era_requirement?: string[];
  explanation_template: string;
  /** Off until measured. See module header. */
  enabled_in_production: boolean;
}

export const RECOGNITION_REGISTRY: RecognitionDefinition[] = [
  {
    recognition_id: "carhartt_detroit_jacket",
    canonical_name: "Carhartt Detroit Jacket",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "carhartt" },
      { field: "identification.item_type", op: "in", value: ["jacket", "work jacket", "canvas jacket"] },
      { field: "features.closure_type", op: "equals", value: "zip_full" },
    ],
    supporting_attributes: [
      { field: "features.collar_type", op: "equals", value: "corduroy", weight: 40 },
      { field: "features.material_signals", op: "contains_any", value: ["duck canvas", "duck", "canvas"], weight: 25 },
      { field: "features.construction_signals", op: "contains_any", value: ["blanket lining", "quilted lining"], weight: 15 },
      { field: "features.pocket_configuration", op: "contains_any", value: ["two lower front", "chest pocket"], weight: 10 },
      { field: "features.silhouette", op: "in", value: ["boxy", "relaxed"], weight: 10 },
    ],
    disqualifying_attributes: [
      { field: "features.hood_present", op: "equals", value: "yes" },
      { field: "features.closure_type", op: "in", value: ["button", "snap", "pullover"] },
      { field: "identification.item_type", op: "in", value: ["chore coat", "puffer", "shirt jacket", "vest"] },
    ],
    candidate_threshold: 50,
    confirmed_threshold: 80,
    minimum_evidence: 3,
    required_photos: ["front"],
    explanation_template: "Corduroy collar, full zip, and duck canvas shell match the Detroit Jacket pattern.",
    enabled_in_production: false,
  },
  {
    recognition_id: "nike_center_swoosh",
    canonical_name: "Nike Center Swoosh",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "nike" },
      { field: "identification.item_type", op: "in", value: ["hoodie", "sweatshirt", "crewneck", "pullover"] },
      { field: "features.logo_placement", op: "equals", value: "center_chest" },
      { field: "features.logo_scale", op: "in", value: ["large", "medium"] },
    ],
    supporting_attributes: [
      { field: "features.logo_identity", op: "contains_any", value: ["swoosh"], weight: 50 },
      { field: "features.logo_scale", op: "equals", value: "large", weight: 25 },
    ],
    // left_chest is a DISQUALIFIER, not a low score. Makes the rule
    // structurally impossible to violate.
    disqualifying_attributes: [
      { field: "features.logo_placement", op: "in", value: ["left_chest", "right_chest", "sleeve", "allover"] },
    ],
    candidate_threshold: 50,
    confirmed_threshold: 75,
    minimum_evidence: 2,
    required_photos: ["front"],
    explanation_template: "Large centered swoosh on the chest, not a left-chest logo.",
    enabled_in_production: false,
  },
  {
    recognition_id: "champion_reverse_weave",
    canonical_name: "Champion Reverse Weave",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "champion" },
      { field: "identification.item_type", op: "in", value: ["crewneck", "hoodie", "sweatshirt"] },
    ],
    supporting_attributes: [
      { field: "features.construction_signals", op: "contains_any", value: ["side seam gusset", "gusset", "reverse weave panel"], weight: 45 },
      { field: "features.tag_characteristics", op: "contains_any", value: ["reverse weave"], weight: 40 },
      { field: "features.material_signals", op: "contains_any", value: ["heavyweight fleece"], weight: 10 },
    ],
    disqualifying_attributes: [],
    candidate_threshold: 45,
    confirmed_threshold: 80,
    minimum_evidence: 2,
    required_photos: ["front", "tag"],
    explanation_template: "Side-seam gusset and Reverse Weave labeling.",
    enabled_in_production: false,
  },
  {
    recognition_id: "patagonia_snap_t",
    canonical_name: "Patagonia Snap-T",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "patagonia" },
      { field: "identification.item_type", op: "in", value: ["fleece", "pullover"] },
      { field: "features.closure_type", op: "in", value: ["snap", "zip_quarter"] },
    ],
    supporting_attributes: [
      { field: "features.construction_signals", op: "contains_any", value: ["snap placket", "placket"], weight: 45 },
      { field: "features.material_signals", op: "contains_any", value: ["fleece"], weight: 25 },
      { field: "features.pocket_configuration", op: "contains_any", value: ["chest pocket"], weight: 15 },
    ],
    disqualifying_attributes: [
      { field: "features.closure_type", op: "equals", value: "zip_full" },
      { field: "features.hood_present", op: "equals", value: "yes" },
    ],
    candidate_threshold: 50,
    confirmed_threshold: 80,
    minimum_evidence: 2,
    required_photos: ["front"],
    explanation_template: "Snap placket over fleece, matching the Snap-T pattern.",
    enabled_in_production: false,
  },
  {
    recognition_id: "tnf_nuptse",
    canonical_name: "The North Face Nuptse",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "the north face" },
      { field: "identification.item_type", op: "in", value: ["puffer", "jacket"] },
      { field: "features.closure_type", op: "equals", value: "zip_full" },
    ],
    supporting_attributes: [
      { field: "features.construction_signals", op: "contains_any", value: ["horizontal baffle", "baffle"], weight: 40 },
      { field: "features.tag_characteristics", op: "contains_any", value: ["nuptse"], weight: 40 },
      { field: "features.silhouette", op: "in", value: ["boxy"], weight: 10 },
    ],
    disqualifying_attributes: [
      { field: "identification.item_type", op: "in", value: ["vest"] },
    ],
    candidate_threshold: 50,
    confirmed_threshold: 80,
    minimum_evidence: 2,
    required_photos: ["front"],
    explanation_template: "Horizontal baffle construction on a full-zip down jacket.",
    enabled_in_production: false,
  },
  {
    recognition_id: "levis_501",
    canonical_name: "Levi's 501",
    applicable_category: ["clothing"],
    // Transcription-gated: the number must be READ, never inferred from silhouette.
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "levi's" },
      { field: "identification.item_type", op: "in", value: ["jeans", "denim pants"] },
      { field: "identification.model_or_product_number", op: "contains_any", value: ["501"] },
    ],
    supporting_attributes: [
      { field: "features.tag_characteristics", op: "contains_any", value: ["red tab"], weight: 20 },
      { field: "features.construction_signals", op: "contains_any", value: ["button fly"], weight: 15 },
    ],
    disqualifying_attributes: [],
    candidate_threshold: 60,
    confirmed_threshold: 85,
    minimum_evidence: 2,
    required_photos: ["front", "tag"],
    explanation_template: "Model number 501 legible on the tag.",
    enabled_in_production: false,
  },
  {
    recognition_id: "levis_type_iii",
    canonical_name: "Levi's Type III Trucker Jacket",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "levi's" },
      { field: "identification.item_type", op: "in", value: ["denim jacket", "jacket"] },
    ],
    supporting_attributes: [
      { field: "features.pocket_configuration", op: "contains_any", value: ["pointed chest flap", "flap chest pocket"], weight: 35 },
      { field: "features.construction_signals", op: "contains_any", value: ["v-shaped seam", "v seam"], weight: 30 },
      { field: "features.tag_characteristics", op: "contains_any", value: ["red tab"], weight: 15 },
    ],
    disqualifying_attributes: [],
    candidate_threshold: 50,
    confirmed_threshold: 80,
    minimum_evidence: 2,
    required_photos: ["front"],
    explanation_template: "Pointed chest flap pockets and V-shaped front seams.",
    enabled_in_production: false,
  },
  {
    recognition_id: "levis_big_e",
    canonical_name: "Levi's Big E",
    applicable_category: ["clothing"],
    // Highest false-positive risk in the batch: a lowercase-e tab is nearly
    // identical at phone-camera resolution and the price difference is large.
    // Requires the tag photo AND an explicit capital-E observation.
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "levi's" },
      { field: "features.tag_characteristics", op: "contains_any", value: ["big e", "capital e"] },
    ],
    supporting_attributes: [
      { field: "features.tag_characteristics", op: "contains_any", value: ["big e", "capital e"], weight: 60 },
      { field: "features.stitching_signals", op: "contains_any", value: ["single stitch"], weight: 25 },
    ],
    disqualifying_attributes: [
      { field: "features.tag_characteristics", op: "contains_any", value: ["lowercase e", "small e"] },
    ],
    candidate_threshold: 60,
    confirmed_threshold: 90,
    minimum_evidence: 2,
    required_photos: ["front", "tag"],
    explanation_template: "Capital-E red tab explicitly observed on the tag.",
    enabled_in_production: false,
  },
  {
    recognition_id: "adidas_trefoil",
    canonical_name: "Adidas Trefoil",
    applicable_category: ["clothing"],
    required_attributes: [
      { field: "identification.canonical_brand", op: "equals_ci", value: "adidas" },
      { field: "features.logo_identity", op: "contains_any", value: ["trefoil"] },
    ],
    supporting_attributes: [
      { field: "features.logo_placement", op: "in", value: ["center_chest", "left_chest"], weight: 35 },
      { field: "features.construction_signals", op: "contains_any", value: ["track jacket"], weight: 20 },
      { field: "features.material_signals", op: "contains_any", value: ["three stripe", "three-stripe"], weight: 15 },
    ],
    disqualifying_attributes: [
      { field: "features.tag_characteristics", op: "contains_any", value: ["climacool", "climalite", "aeroready"] },
    ],
    candidate_threshold: 50,
    confirmed_threshold: 75,
    minimum_evidence: 2,
    required_photos: ["front"],
    explanation_template: "Trefoil logo present.",
    enabled_in_production: false,
  },
];

/**
 * Is any recognition definition live?
 *
 * Drives whether the `features` block is requested from the model at all.
 * Every definition scores against features.*, so while none are enabled the
 * block is ~119 output tokens — about 1.6s of generation — feeding a system
 * that discards the result.
 *
 * Reading the flags rather than hardcoding false is the whole point: flipping
 * any definition to enabled_in_production:true restores the block
 * automatically, with no schema, prompt or type edit. Deleting `features`
 * outright would have silently broken all nine definitions the day recognition
 * shipped, with no obvious cause.
 */
export function anyRecognitionEnabled(): boolean {
  return RECOGNITION_REGISTRY.some(d => d.enabled_in_production);
}