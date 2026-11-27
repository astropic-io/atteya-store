import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { HOME_TEXT_LIMITS } from '@features/home/data/home.data';
import { HomeHelpBox } from '../../models/home-manager.model';
import { textLimitState } from '../../utils/home-text-limits';

/** Admin → Home Page → Section 5: the WhatsApp Help box (ATS-348). */
@Component({
  selector: 'app-home-help-box-editor',
  templateUrl: './home-help-box-editor.component.html',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule],
})
export class HomeHelpBoxEditorComponent {
  readonly helpBox = input.required<HomeHelpBox>();
  /** False when the store has no WhatsApp number set. */
  readonly hasNumber = input<boolean>(true);

  readonly enabledChange = output<boolean>();
  readonly headlineChange = output<string>();
  readonly textChange = output<string>();
  readonly messageChange = output<string>();

  readonly limits = HOME_TEXT_LIMITS;
  readonly headlineState = computed(() =>
    textLimitState(this.helpBox().headline, HOME_TEXT_LIMITS.helpHeadline),
  );
  readonly textState = computed(() => textLimitState(this.helpBox().text, HOME_TEXT_LIMITS.helpText));
  readonly messageState = computed(() =>
    textLimitState(this.helpBox().message, HOME_TEXT_LIMITS.helpMessage),
  );

  onEnabledChange(event: MatSlideToggleChange): void {
    this.enabledChange.emit(event.checked);
  }
}
