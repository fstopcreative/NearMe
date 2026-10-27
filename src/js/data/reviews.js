/*
 * Corelain — client reviews shown on Near Me ("What our clients say").
 * The list lives in src/data/reviews.json and is edited in the admin panel (/admin).
 * The section stays hidden while it is empty. Each review:
 *   { quote, name, role, area, project, rating }   (role: Homeowner · Adjoining owner · Architect · Builder)
 */
import data from '../../data/reviews.json';

export const REVIEWS = Array.isArray(data.reviews) ? data.reviews : [];
