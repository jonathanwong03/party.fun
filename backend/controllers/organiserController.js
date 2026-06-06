import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';

export const getDashboard = createPlaceholderHandler('organiser-dashboard');
export const getCreateEvent = createPlaceholderHandler('create-event');
export const postCreateEvent = createPlaceholderHandler('create-event');
export const getEditEvent = createPlaceholderHandler('edit-event');
export const patchEvent = createPlaceholderHandler('edit-event');
export const deleteEvent = createPlaceholderHandler('delete-event');
