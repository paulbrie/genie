import { Subject } from "subjecto/core";
import { emptyReviewDiffState, type ReviewDiffState } from "../types/review-diff";

/** State for the diffx-style review-changes drawer. Flat top-level shape (arrays
 *  replaced immutably), mirroring $fileExplorer — so a plain Subject fits the
 *  project's "Subject for simple/flat values" convention. */
export const $reviewDiff = new Subject<ReviewDiffState>(emptyReviewDiffState());
