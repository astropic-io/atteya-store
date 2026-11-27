import { Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { STORE_INFO, whatsappChatUrl } from '@core/config/store-info';
import { HomeHelpBox } from '../../models/home.model';

/**
 * Home Page Section 5 (ATS-348): a help box that opens the store's WhatsApp chat, with the
 * admin's first message already written. The page leaves it out when no number is set.
 */
@Component({
  selector: 'app-help-box-section',
  host: {
    class: 'block w-full',
  },
  templateUrl: './help-box-section.component.html',
  imports: [MatButtonModule, SharedIconModule],
})
export class HelpBoxSectionComponent {
  readonly helpBox = input.required<HomeHelpBox>();
  /** Admin preview: the button opens nothing. */
  readonly previewMode = input<boolean>(false);

  readonly whatsappUrl = computed(() =>
    whatsappChatUrl(STORE_INFO.contact.whatsapp, this.helpBox().message || null),
  );
}
