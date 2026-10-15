import bakedTemplates from './templates.json';
import { templatePlaceholders, theoryTemplates, type Template } from './templateCore';

export * from './templateCore';
export const templates: Template[] = [...bakedTemplates as Template[], ...templatePlaceholders, ...theoryTemplates];
