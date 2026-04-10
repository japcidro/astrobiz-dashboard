// ============================================
// Facebook Ads Module — Main Entry Point
// Copy this entire folder to any Next.js project
// ============================================

// Core API functions
export { fbPost, fbGet, uploadImageClient, uploadVideoClient, uploadFileClient, uploadImageServer } from "./fb-api";

// Single ad creation
export { createAd } from "./create-ad";

// Bulk ad creation
export { bulkCreateAds } from "./bulk-create";

// All types
export type {
  // Campaign
  CampaignObjective,
  BidStrategy,
  SpecialAdCategory,
  CampaignInput,
  // Ad Set
  OptimizationGoal,
  BillingEvent,
  TargetingInterest,
  TargetingSpec,
  AdSetInput,
  // Ad
  CTAType,
  AdInput,
  // Creative upload
  UploadResult,
  // Single creation
  CreateAdRequest,
  CreateAdResult,
  // Bulk creation
  BulkAdRow,
  BulkCreateRequest,
  BulkCreateResult,
} from "./types";
