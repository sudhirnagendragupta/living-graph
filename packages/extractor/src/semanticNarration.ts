/**
 * semanticNarration.ts
 *
 * Universal semantic narration helper for AST-extracted edges and workflows.
 * Guarantees that every edge has human-grade instructional voiceover narration.
 */

export function cleanLabelText(text: string): string {
  let cleaned = text
    .replace(/^[+\-*•\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > 0 && !/[A-Z]/.test(cleaned.slice(1))) {
    cleaned = cleaned
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return cleaned;
}

export function cleanSelectorToLabel(selector?: string): string {
  if (!selector) return '';
  let str = selector.trim();

  // 1. If selector has Playwright :has-text("..."), extract the clean text directly
  const hasTextMatch = str.match(/:has-text\(["']([^"']+)["']\)/i);
  if (hasTextMatch && hasTextMatch[1].trim()) {
    return cleanLabelText(hasTextMatch[1]);
  }

  // 2. If selector has [aria-label="..."], extract it directly
  const ariaMatch = str.match(/aria-label=["']([^"']+)["']/i);
  if (ariaMatch && ariaMatch[1].trim() && !ariaMatch[1].includes('${')) {
    return cleanLabelText(ariaMatch[1]);
  }

  // 3. If selector has [placeholder*="..."], extract it directly
  const placeholderMatch = str.match(/placeholder\*?=["']([^"']+)["']/i);
  if (placeholderMatch && placeholderMatch[1].trim()) {
    return cleanLabelText(placeholderMatch[1]);
  }

  // 4. Strip JavaScript template interpolation: ${...} and any trailing unclosed ${...
  str = str.replace(/\$\{[^}]*\}/g, '').replace(/\$\{[^}]*$/g, '');

  // 5. If it's a dynamic table/list row pattern like ticket-row, ticket-row-, row-...
  if (/\b(ticket[-_]?row|ticket[-_]?item)\b/i.test(str)) {
    return 'Ticket';
  }
  if (/\b(row|item|record)[-_]?\b/i.test(str) && (str.includes('tr') || str.includes('table') || str.includes('list'))) {
    return 'Item';
  }

  // 6. Strip HTML tag prefixes and brackets
  str = str.replace(/^(button|input|select|textarea|form|nav|a|div|span|section|header|tr|td|li|ul)\b\[?/gi, '');

  // 7. Strip attribute names
  str = str.replace(/data-testid=["']?/gi, '')
    .replace(/aria-label=["']?/gi, '')
    .replace(/placeholder=["']?/gi, '')
    .replace(/id=["']?/gi, '');

  // 8. Strip punctuation, quotes, brackets, hashes, backticks
  str = str.replace(/["'\]#.`$]/g, '');

  // 9. Convert dashes and underscores to spaces
  str = str.replace(/[-_]+/g, ' ');

  // 10. Strip common code noise tokens
  str = str.replace(/\b(btn|button|input|field|txt|lbl|modal|dialog|container|wrapper)\b/gi, '');

  // 11. Normalize view/dashboard prefixes: e.g. "dashboard view tickets" -> "view tickets"
  str = str.replace(/^dashboard\s+(view|open|show|goto)/i, '$1');

  return cleanLabelText(str);
}

export function formatStepTitle(
  targetLabel?: string,
  targetSelector?: string,
  actionType: string = 'click'
): string {
  const raw = `${targetLabel || ''} ${targetSelector || ''}`.trim();
  const clean = cleanSelectorToLabel(targetLabel || targetSelector);
  const isInvite = /invite|member|teammate|collaborator|team/i.test(raw) || /invite|member|teammate/i.test(clean);
  const isAuth = /login|signin|sign[-_]in|auth/i.test(raw) || /login|sign\s*in/i.test(clean);

  // Invite context titles
  if (isInvite) {
    if (actionType === 'fill') {
      if (/name|user/i.test(clean) || /name/i.test(raw)) return 'Enter Teammate Name';
      if (/email/i.test(clean) || /email/i.test(raw)) return 'Enter Teammate Email';
    }
    if (actionType === 'select' || /role|permission/i.test(clean)) {
      return 'Select Role';
    }
    if (actionType === 'submit' || /submit|send/i.test(raw) || /submit|send/i.test(clean)) {
      return 'Send Invitation';
    }
    if (/invite/i.test(clean) || /invite/i.test(raw)) {
      return 'Invite Teammate';
    }
    if (/team/i.test(clean) || /team/i.test(raw)) {
      return 'Team Members';
    }
  }

  // Ticket queue / detail context titles
  if (/ticket\s*row|select\s*ticket/i.test(clean) || /ticket[-_]row/i.test(raw)) {
    return 'Select Ticket';
  }
  if (/view\s*tickets/i.test(clean)) {
    return 'View Tickets';
  }
  if (/add\s*tag/i.test(clean) || /add[-_]tag/i.test(raw)) {
    return 'Add Tag';
  }
  if (/tag\s*name|new\s*tag|tag\s*text/i.test(clean) || (actionType === 'fill' && /tag/i.test(raw))) {
    return 'Enter Tag Name';
  }
  if (clean.toLowerCase() === 'add' || (/submit/i.test(raw) && /tag|14406/i.test(raw))) {
    return 'Confirm Tag';
  }
  if (/new\s*ticket|create\s*ticket/i.test(clean)) {
    return 'New Ticket';
  }
  if (isAuth) {
    if (actionType === 'fill') {
      if (/email/i.test(clean)) return 'Enter Work Email';
      if (/password/i.test(clean)) return 'Enter Password';
    }
    return 'Sign In';
  }

  // Settings tabs
  if (/settings[-_]tab[-_]team|team\s*members?/i.test(raw)) {
    return 'Team Members';
  }
  if (/settings[-_]tab[-_]profile|profile/i.test(raw) && /settings/i.test(raw)) {
    return 'Profile';
  }
  if (/settings[-_]tab[-_]notifications|notifications/i.test(raw) && /settings/i.test(raw)) {
    return 'Notifications';
  }
  if (/settings[-_]tab[-_]api_keys|api\s*keys/i.test(raw) && /settings/i.test(raw)) {
    return 'API Keys';
  }

  if (actionType === 'fill') {
    if (/comment|reply|note/i.test(clean) || /comment|reply|note/i.test(raw)) return 'Add Comment';
    return clean ? (/^enter\b/i.test(clean) ? clean : `Enter ${clean}`) : 'Enter Information';
  }
  if (actionType === 'select') {
    return clean ? (/^select\b/i.test(clean) ? clean : `Select ${clean}`) : 'Select Option';
  }
  if (actionType === 'submit') {
    if (/comment|reply/i.test(raw)) return 'Post Update';
    if (!clean || clean.toLowerCase() === 'submit' || clean.toLowerCase() === 'form') {
      return 'Submit Form';
    }
    if (/^submit\b/i.test(clean)) {
      return clean;
    }
    return `Submit ${clean}`;
  }

  const result = clean || 'Perform Action';
  return result.replace(/^(\b\w+\b)\s+\1\b/i, '$1');
}

export function formatSemanticNarration(
  actionType: string = 'click',
  targetLabel?: string,
  targetSelector?: string,
  fallbackId?: string
): string {
  const rawTarget = `${targetLabel || ''} ${targetSelector || ''} ${fallbackId || ''}`.trim();
  const cleanTarget = cleanSelectorToLabel(targetLabel || targetSelector || fallbackId);
  const isInvite = /invite|member|teammate|collaborator/i.test(rawTarget) || /invite|member|teammate/i.test(cleanTarget);
  const isAuth = /login|signin|sign[-_]in|auth/i.test(rawTarget);

  // 1. Fill Actions
  if (actionType === 'fill') {
    // Invite context
    if (isInvite) {
      if (/name|fullname|first_name|display_name/i.test(cleanTarget) || /name/i.test(rawTarget)) {
        return "Enter the teammate's full name.";
      }
      if (/email/i.test(cleanTarget) || /email/i.test(rawTarget)) {
        return "Enter the teammate's email address to send the invitation.";
      }
    }

    // Auth context (strict check - ONLY if login/signin/auth appears in selector or context)
    if (isAuth) {
      if (/email/i.test(cleanTarget)) return 'Enter your work email address in the login field.';
      if (/password/i.test(cleanTarget)) return 'Type your secure password in the password field.';
    }

    if (/tag\s*name|tag/i.test(cleanTarget) || /tag/i.test(rawTarget)) {
      return 'Type the tag name in the input field.';
    }
    if (/comment|reply|note|message/i.test(cleanTarget) || /comment|reply|note/i.test(rawTarget)) {
      return 'Type your comment into the internal note box.';
    }
    if (/title|subject/i.test(cleanTarget)) {
      return 'Enter a clear, descriptive title for the new record.';
    }
    if (/name/i.test(cleanTarget)) {
      return `Enter the ${cleanTarget.toLowerCase()} in the input field.`;
    }
    if (/desc|detail|body|notes/i.test(cleanTarget)) {
      return 'Provide complete details explaining the issue or request.';
    }
    if (/search|filter|query/i.test(cleanTarget)) {
      return 'Type into the search box to filter records in the queue.';
    }
    return `Enter your information in the ${cleanTarget || 'input'} field.`;
  }

  // 2. Select Actions
  if (actionType === 'select') {
    if (isInvite || /role|permission|access/i.test(cleanTarget)) {
      return 'Choose the appropriate permission role for the new teammate.';
    }
    if (/priority|urgency/i.test(cleanTarget)) return 'Choose the urgency priority from the dropdown.';
    if (/category|type/i.test(cleanTarget)) return 'Select the appropriate category from the options list.';
    return `Select your option from the ${cleanTarget || 'dropdown'} menu.`;
  }

  // 3. Submit Actions
  if (actionType === 'submit' || /submit/i.test(cleanTarget)) {
    if (isInvite || /invite/i.test(rawTarget)) {
      return 'Click Send Invitation to invite the teammate to the workspace.';
    }
    if (isAuth || /login|sign\s*in/i.test(cleanTarget)) {
      return 'Submit the form to authenticate and access your workspace.';
    }
    if (/tag/i.test(cleanTarget) || /tag/i.test(rawTarget)) {
      return 'Click Add to save and attach the tag.';
    }
    if (/comment|reply|update|note/i.test(cleanTarget) || /comment|reply|7828/i.test(rawTarget)) {
      return 'Click Post Update to publish the comment.';
    }
    return 'Submit the form to confirm and save your changes.';
  }

  // 4. Click Actions
  // Invite dialog & team tab
  if (/settings[-_]tab[-_]team|team\s*members?/i.test(rawTarget) || (cleanTarget.toLowerCase() === 'team members')) {
    return 'Click Team Members to open team management settings.';
  }
  if (/invite[-_]member[-_]btn|invite\s*teammate/i.test(rawTarget) || (/invite/i.test(cleanTarget) && /teammate|member/i.test(cleanTarget))) {
    return 'Click Invite Teammate to open the invitation dialog.';
  }
  if (/invite/i.test(cleanTarget)) {
    return 'Click Invite to open the member invitation dialog.';
  }

  // Table row or queue item click
  if (
    /ticket\s*row/i.test(cleanTarget) ||
    /ticket[-_]row/i.test(rawTarget) ||
    (cleanTarget.toLowerCase() === 'ticket' && (rawTarget.includes('row') || rawTarget.includes('tr') || rawTarget.includes('queue') || rawTarget.includes('list') || actionType === 'click'))
  ) {
    return 'Select a ticket from the queue to view its details.';
  }
  if (/row|item/i.test(cleanTarget) && (rawTarget.includes('tr') || rawTarget.includes('table') || rawTarget.includes('list'))) {
    return 'Select an item from the list to view its details.';
  }

  if (/sign\s*in|login/i.test(cleanTarget)) return 'Click Sign In to authenticate and access your workspace.';
  if (/sign\s*out|logout/i.test(cleanTarget)) return 'Click Sign Out to safely end your session.';
  if (/ticket/i.test(cleanTarget) && /new|create/i.test(cleanTarget)) return 'Click New Ticket to begin creating a support request.';
  if (/ticket/i.test(cleanTarget) && /view|list|queue/i.test(cleanTarget)) return 'Click View Tickets to navigate to the support queue.';

  // Tag handling
  if (/add\s*tag/i.test(cleanTarget) || (cleanTarget.toLowerCase() === 'tag' && /add/i.test(rawTarget))) {
    return 'Click Add Tag to add a new tag to the ticket.';
  }
  if (cleanTarget.toLowerCase() === 'add' && /tag/i.test(rawTarget)) {
    return 'Click Add to save and attach the tag.';
  }

  // Settings tabs
  if (/profile/i.test(cleanTarget) && /settings/i.test(rawTarget)) return 'Click Profile to view personal account settings.';
  if (/notification/i.test(cleanTarget) && /settings/i.test(rawTarget)) return 'Click Notifications to configure your alert preferences.';
  if (/api\s*keys?/i.test(cleanTarget) && /settings/i.test(rawTarget)) return 'Click API Keys to manage access tokens.';

  if (/new|create/i.test(cleanTarget)) {
    const item = cleanTarget.replace(/new|create/gi, '').trim() || 'item';
    return `Click Create to begin creating a new ${item}.`;
  }
  if (/^add\b/i.test(cleanTarget)) {
    const item = cleanTarget.replace(/^add\b/gi, '').trim();
    return `Click Add ${item} to add it to the record.`;
  }
  if (/view|list|queue|browse/i.test(cleanTarget)) {
    const items = cleanTarget.replace(/view|list|queue|browse/gi, '').trim() || 'items';
    return `Click View to open the ${items} queue.`;
  }
  if (/priority|severity|urgent|urgency|high|medium|low/i.test(cleanTarget)) return 'Select the urgency priority level.';
  if (/next|continue|proceed/i.test(cleanTarget)) return 'Click Next to proceed to the following step.';
  if (/back|previous/i.test(cleanTarget)) return 'Click Back to return to the previous section.';
  if (/delete|remove/i.test(cleanTarget)) return 'Click Delete to open the confirmation modal.';
  if (/save|confirm/i.test(cleanTarget)) return 'Click Save to record your updates.';

  const displayTarget = cleanTarget ? `'${cleanTarget}'` : 'the highlighted element';
  return `Click ${displayTarget} to continue.`;
}

export function cleanWorkflowTitle(wfId: string, rawTitle?: string): string {
  if (
    rawTitle &&
    !rawTitle.startsWith('wf_') &&
    !rawTitle.startsWith('wf ') &&
    !rawTitle.includes('node_') &&
    !rawTitle.includes('form_') &&
    // A bare 3+ digit run (e.g. "Form 7828") is always a synthetic AST
    // offset/hash leaking through, never meaningful UI vocabulary — reject
    // it here too so a title that already slipped past id-based guards
    // above still falls through to the cleanup below instead of shipping
    // as-is. No \b here: "_" counts as a word character in JS regex, so
    // \b never matches between "_" and a digit in an underscore-joined id.
    !/\d{3,}/.test(rawTitle)
  ) {
    return rawTitle;
  }

  if (wfId.includes('login') || wfId.includes('auth')) {
    return 'User Sign-In & Dashboard Access';
  }
  if (wfId.includes('new_ticket_wizard') || wfId.includes('create_ticket')) {
    return 'Create Support Ticket Wizard';
  }
  if (wfId.includes('ticket_list') || wfId.includes('queue')) {
    return 'Support Queue & Ticket Exploration';
  }
  if (wfId.includes('settings')) {
    return 'Account Settings & Preferences';
  }

  const clean = wfId
    .replace(/^wf_journey_|^wf_/, '')
    .replace(/node_/g, '')
    // Strip bare numeric AST offsets/hashes (e.g. "form_7828") — they carry
    // no semantic meaning and would otherwise surface as "Form 7828".
    .replace(/\d{3,}/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
